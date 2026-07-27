use std::env;
use std::fmt;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::str::FromStr;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, NewSessionRequest, PromptRequest, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionNotification, SetSessionConfigOptionRequest, TextContent,
};
use agent_client_protocol::{AcpAgent, Agent, ConnectionTo, LineDirection};
use futures::channel::{mpsc, oneshot};
use futures::future::{BoxFuture, Either, select};
use futures::{FutureExt, StreamExt};
use serde_json::Value;

use crate::config::{ConfigControl, controls};
use crate::desk::PermissionDesk;
use crate::error::{AcpError, Result};
use crate::permission::{Decision, decide};
use crate::recorder::Recorder;
use crate::run_slot::RunSlot;
use crate::sessions::SessionBook;
use crate::stderr::StderrLog;

const BUSY: &str = "a turn is already in flight on this session";
const GONE: &str = "the agent connection is no longer running";
const UNREADABLE: &str = "the agent reported a stop reason the client could not read";
const CANCELLED: &str = "cancelled";
const CHANGING: &str = "a selector cannot be changed while a turn is in flight";

/// Names the file every line of the conversation is copied to, when set.
///
/// Absent or blank means no trace at all. A trace holds whatever the agent
/// said, so it is asked for deliberately and never left on by default.
const TRACE: &str = "POIETICA_ACP_TRACE";

/// How the agent process is started.
#[derive(Clone, Debug)]
pub struct AgentSpawn {
    /// A shell-style command line, for example: kimi acp.
    ///
    /// The process is the transport: the protocol speaks JSON-RPC over its
    /// standard input and output, which is why nothing here opens a socket.
    pub command: String,
    /// The working directory the session is created against.
    pub cwd: PathBuf,
}

/// What the driver is asked to do next.
enum Command {
    Prompt {
        text: String,
        /// Boxed because a channel message is sized by its largest variant,
        /// and stopping a turn should not be charged for starting one.
        recorder: Box<Recorder>,
        reply: oneshot::Sender<Result<String>>,
    },
    Cancel,
    Shutdown,
    /// Answers with the selectors the session is currently offering.
    Selectors {
        reply: oneshot::Sender<Result<Vec<ConfigControl>>>,
    },
    /// Asks the agent to change one selector, and adopts its answer.
    Select {
        config_id: String,
        value: String,
        reply: oneshot::Sender<Result<Vec<ConfigControl>>>,
    },
}

/// A handle onto a live session. Cheap to clone, safe to hold anywhere.
#[derive(Clone)]
pub struct AgentClient {
    commands: mpsc::UnboundedSender<Command>,
}

impl fmt::Debug for AgentClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AgentClient")
            .field("connected", &!self.commands.is_closed())
            .finish_non_exhaustive()
    }
}

impl AgentClient {
    /// Starts a turn, recording it with the recorder handed in.
    ///
    /// The answer resolves to the stop reason the agent reported once the turn
    /// is over. Every frame of the turn reaches the caller through the
    /// recorder's sink long before that, which is what the interface consumes.
    ///
    /// # Errors
    ///
    /// Fails when the driver is no longer running.
    pub fn prompt(
        &self,
        text: String,
        recorder: Recorder,
    ) -> Result<oneshot::Receiver<Result<String>>> {
        let (reply, answer) = oneshot::channel();

        self.send(Command::Prompt {
            text,
            recorder: Box::new(recorder),
            reply,
        })?;

        Ok(answer)
    }

    /// Asks the agent to stop the turn that is in flight.
    ///
    /// Cancellation is cooperative: the agent may still finish normally, and
    /// the turn's own answer reports which of the two happened.
    ///
    /// # Errors
    ///
    /// Fails when the driver is no longer running.
    pub fn cancel(&self) -> Result<()> {
        self.send(Command::Cancel)
    }

    /// Ends the session and lets the agent process exit.
    ///
    /// # Errors
    ///
    /// Fails when the driver is no longer running.
    pub fn shutdown(&self) -> Result<()> {
        self.send(Command::Shutdown)
    }

    /// Asks which selectors the session is offering.
    ///
    /// The list is whatever the agent reported. This crate never adds a
    /// model, a reasoning level or a mode of its own.
    ///
    /// # Errors
    ///
    /// Fails when the driver is no longer running.
    pub fn selectors(&self) -> Result<oneshot::Receiver<Result<Vec<ConfigControl>>>> {
        let (reply, answer) = oneshot::channel();

        self.send(Command::Selectors { reply })?;

        Ok(answer)
    }

    /// Changes one selector to one of the values it offered.
    ///
    /// The answer is the whole list again, because changing one selector
    /// may add or remove another: a model with no reasoning levels takes
    /// that selector away with it.
    ///
    /// # Errors
    ///
    /// Fails when the driver is no longer running.
    pub fn select(
        &self,
        config_id: String,
        value: String,
    ) -> Result<oneshot::Receiver<Result<Vec<ConfigControl>>>> {
        let (reply, answer) = oneshot::channel();

        self.send(Command::Select {
            config_id,
            value,
            reply,
        })?;

        Ok(answer)
    }

    fn send(&self, command: Command) -> Result<()> {
        self.commands
            .unbounded_send(command)
            .map_err(|_disconnected| AcpError::Protocol {
                message: GONE.to_owned(),
            })
    }
}

/// A connected session, before anything has been spawned onto a runtime.
///
/// The crate stays runtime-agnostic on purpose: it hands back a future and the
/// composition root decides which executor runs it.
pub struct AgentConnection {
    /// Sends prompts, cancellation and shutdown to the session.
    pub client: AgentClient,
    /// The sessions of this connection, keyed by the name the agent gave
    /// them.
    ///
    /// Held by the caller so a session opened later is entered in the same
    /// book the protocol handlers already read from.
    pub book: SessionBook,
    /// Resolves with the session identifier once the agent has created it.
    pub session_id: oneshot::Receiver<String>,
    /// Must be spawned; the session only lives while this future is polled.
    pub driver: BoxFuture<'static, Result<()>>,
}

impl fmt::Debug for AgentConnection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AgentConnection")
            .field("client", &self.client)
            .finish_non_exhaustive()
    }
}

/// Appends one observed line to the trace file.
///
/// Nothing is parsed and nothing is buffered: the point is to show what the
/// two sides actually said. A trace that cannot be written is not worth
/// failing a session over, so every error here is dropped on purpose.
fn trace(path: &str, label: &str, line: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ignored = writeln!(file, "{label} {line}");
    }
}

/// The response that carries a decision back to the agent.
fn reply(decision: &Decision) -> RequestPermissionResponse {
    match decision.option_id() {
        Some(option_id) => RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new(option_id.clone()),
        )),
        None => RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled),
    }
}

/// Spawns the agent, creates one session, and keeps it open for many turns.
///
/// Updates are routed through the book. Every frame the agent sends names
/// its session; the book turns that name into that session's slot, and the
/// slot holds a recorder only for as long as that session's turn is in
/// flight. A frame for a session this client never opened, and a frame that
/// arrives between turns, are both dropped rather than attributed to the run
/// that came before them.
///
/// Permission requests are routed through the desk: the handler records the
/// request, waits for an answer that arrives on a different call entirely, and
/// records the answer before returning it to the agent.
///
/// # Errors
///
/// Fails when the command line cannot be turned into a process.
pub fn connect(spawn: AgentSpawn, slot: RunSlot, desk: PermissionDesk) -> Result<AgentConnection> {
    let AgentSpawn { command, cwd } = spawn;

    let agent = AcpAgent::from_str(&command).map_err(|error| AcpError::Spawn {
        message: error.to_string(),
    })?;

    // What the agent says for itself. A provider rejection is reported on the
    // process error stream and the turn still ends normally, so this is the
    // only account of such a turn there is. The SDK offers the stream through
    // its own observer, which is why nothing here reads a pipe.
    let diagnostics = StderrLog::new();
    let observed = diagnostics.clone();

    // The observer sees both halves. Only the standard error half was kept,
    // which left the protocol itself unobservable from inside the client.
    let traced = env::var(TRACE).ok().filter(|path| !path.trim().is_empty());

    let agent = agent.with_debug(move |line, direction| {
        let is_stderr = direction == LineDirection::Stderr;

        if let Some(path) = traced.as_deref() {
            trace(path, if is_stderr { "err " } else { "wire" }, line);
        }

        if is_stderr {
            observed.push(line);
        }
    });

    let (commands, receiver) = mpsc::unbounded::<Command>();
    let (ready, session_id) = oneshot::channel::<String>();

    // One book per connection. The handlers live as long as the connection
    // and read it by name; the driver writes to it as sessions are created.
    let book = SessionBook::new();
    let updates = book.clone();
    let permissions = book.clone();
    let first = book.clone();
    let waiting = desk.clone();

    let driver = async move {
        let served = agent_client_protocol::Client
            .builder()
            .name("poietica")
            .on_receive_notification(
                async move |notification: SessionNotification, _cx| {
                    let named = notification.session_id.to_string();

                    // A frame naming a session this client never opened is
                    // not ours to record, so it is dropped here rather than
                    // written against whichever session happens to be open.
                    if let Ok(Some(slot)) = updates.slot(&named) {
                        let _routed = slot.record(|recorder| {
                            recorder.record_session_update(&notification);
                        });
                    }

                    Ok(())
                },
                agent_client_protocol::on_receive_notification!(),
            )
            .on_receive_request(
                async move |request: RequestPermissionRequest, responder, _connection| {
                    let mut opened = None;
                    let named = request.session_id.to_string();

                    // A question belongs to the session that asked it, and
                    // is recorded there or nowhere.
                    if let Ok(Some(slot)) = permissions.slot(&named) {
                        let _routed = slot.record(|recorder| {
                            opened = Some(recorder.record_permission_requested(&request));
                        });
                    }

                    // A request arriving outside a turn has nowhere to be
                    // recorded and nobody to answer it. Refusing is the only
                    // honest reply; leaving the agent blocked is not.
                    let Some(request_id) = opened else {
                        return responder.respond(reply(&decide(&request)));
                    };

                    let decision = match waiting.wait(&request_id, &request) {
                        // A dropped sender means the turn ended first, which
                        // is exactly what the protocol calls a cancellation.
                        Ok(answer) => answer.await.unwrap_or(Decision::Cancel),
                        // An unusable desk is our fault, not the agent's, so
                        // the turn is not left hanging on it.
                        Err(_unusable) => decide(&request),
                    };

                    // The answer belongs to the same session as the
                    // question, and is recorded there or nowhere.
                    if let Ok(Some(slot)) = permissions.slot(&named) {
                        let _routed = slot.record(|recorder| {
                            recorder.record_permission_resolved(&request_id, &decision);
                        });
                    }

                    responder.respond(reply(&decision))
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_with(agent, move |connection: ConnectionTo<Agent>| async move {
                let mut receiver = receiver;

                connection
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await?;

                let session = connection
                    .send_request(NewSessionRequest::new(cwd))
                    .block_task()
                    .await?;
                // The agent reports its selectors here and nowhere else,
                // so a list that is dropped now cannot be recovered.
                let mut selectors = match session.config_options.as_deref() {
                    Some(offered) => controls(offered),
                    None => Vec::new(),
                };
                let session_id = session.session_id.clone();

                // The book is what turns a name into a slot, so this session
                // is entered in it before any frame of it can arrive.
                //
                // A book that cannot be written to could never record this
                // session, so its name is never published: the caller is
                // told by the dropped sender instead of being handed a
                // session that quietly records nothing.
                if first.adopt(&session_id.to_string(), slot.clone()).is_err() {
                    return Ok(());
                }

                // Nobody may still be waiting for the identifier, and that is
                // not a failure of the session.
                let _ignored = ready.send(session_id.to_string());

                'commands: loop {
                    let Some(message) = receiver.next().await else {
                        break 'commands;
                    };

                    let (text, recorder, reply_to) = match message {
                        Command::Shutdown => break 'commands,
                        // Nothing is in flight, so there is nothing to stop.
                        Command::Cancel => continue 'commands,
                        Command::Selectors { reply } => {
                            let _ignored = reply.send(Ok(selectors.clone()));

                            continue 'commands;
                        }
                        Command::Select {
                            config_id,
                            value,
                            reply,
                        } => {
                            let changed = connection
                                .send_request(SetSessionConfigOptionRequest::new(
                                    session_id.clone(),
                                    config_id,
                                    // The request takes a value the schema
                                    // can convert, and it converts a
                                    // borrowed string, not an owned one.
                                    value.as_str(),
                                ))
                                .block_task()
                                .await;

                            let outcome = match changed {
                                Ok(response) => {
                                    selectors = controls(&response.config_options);

                                    Ok(selectors.clone())
                                }
                                Err(error) => Err(AcpError::Protocol {
                                    message: error.to_string(),
                                }),
                            };

                            let _ignored = reply.send(outcome);

                            continue 'commands;
                        }
                        Command::Prompt {
                            text,
                            recorder,
                            reply,
                        } => (text, recorder, reply),
                    };

                    // One turn at a time. A second prompt is refused here
                    // rather than allowed to interleave two runs on one log.
                    if let Err(error) = slot.install(*recorder) {
                        let _ignored = reply_to.send(Err(error));

                        continue 'commands;
                    }

                    // A turn is only answerable for itself, so it starts with an
                    // empty record rather than the previous turn to explain it.
                    diagnostics.clear();

                    // The prompt is recorded before it is sent, so a turn that
                    // fails on the first request still shows what was asked.
                    let _routed = slot.record(|recorder| {
                        recorder.record_run_started(&session_id.to_string(), &text);
                    });

                    let mut pending = Box::pin(
                        connection
                            .send_request(PromptRequest::new(
                                session_id.clone(),
                                vec![ContentBlock::Text(TextContent::new(text))],
                            ))
                            .block_task(),
                    );

                    let mut stopping = false;

                    let answered = loop {
                        match select(pending, receiver.next()).await {
                            Either::Left((result, _)) => break Some(result),
                            Either::Right((message, in_flight)) => match message {
                                // Dropping the request handle before the
                                // response arrives is how the SDK sends
                                // the protocol's cancellation notification,
                                // so the agent is told rather than abandoned.
                                None | Some(Command::Shutdown) => {
                                    stopping = true;
                                    drop(in_flight);

                                    break None;
                                }
                                Some(Command::Cancel) => {
                                    drop(in_flight);

                                    break None;
                                }
                                Some(Command::Prompt { reply: refused, .. }) => {
                                    let _ignored = refused.send(Err(AcpError::Protocol {
                                        message: BUSY.to_owned(),
                                    }));
                                    pending = in_flight;
                                }
                                Some(Command::Selectors { reply }) => {
                                    let _ignored = reply.send(Ok(selectors.clone()));
                                    pending = in_flight;
                                }
                                // Changing a selector takes a request of
                                // our own, and this task is already
                                // awaiting one, so it is refused out loud.
                                Some(Command::Select { reply, .. }) => {
                                    let _ignored = reply.send(Err(AcpError::Protocol {
                                        message: CHANGING.to_owned(),
                                    }));
                                    pending = in_flight;
                                }
                            },
                        }
                    };

                    // The turn is over, so nobody is going to answer a
                    // permission request that is still open. Releasing them
                    // first lets each handler finish before the log is closed.
                    desk.clear();

                    let Ok(Some(mut recorder)) = slot.take() else {
                        let _ignored = reply_to.send(Err(AcpError::RecorderPoisoned));

                        if stopping {
                            break 'commands;
                        }

                        continue 'commands;
                    };

                    recorder.record_pending_cancelled();

                    // Handed over before the turn is settled, because the
                    // recorder decides whether this turn needs it.
                    recorder.set_diagnostics(diagnostics.tail());

                    let settled = match answered {
                        None => {
                            recorder.record_run_cancelled();

                            Ok(CANCELLED.to_owned())
                        }
                        Some(Err(error)) => {
                            let message = error.to_string();
                            recorder.record_run_failed(&message);

                            Err(AcpError::Protocol { message })
                        }
                        // The wire form is the contract, so the stop reason is
                        // taken from serialisation rather than from a
                        // hand-written mapping.
                        Some(Ok(response)) => {
                            if let Ok(Value::String(reason)) =
                                serde_json::to_value(response.stop_reason)
                            {
                                recorder.record_run_finished(&reason);

                                Ok(reason)
                            } else {
                                let message = UNREADABLE.to_owned();
                                recorder.record_run_failed(&message);

                                Err(AcpError::Protocol { message })
                            }
                        }
                    };

                    // A write that failed mid-turn could not be reported at the
                    // time, so the turn only counts as successful once the
                    // recorder confirms it.
                    let settled = match recorder.take_failure() {
                        Some(failure) => Err(failure),
                        None => settled,
                    };

                    let _ignored = reply_to.send(settled);

                    if stopping {
                        break 'commands;
                    }
                }

                Ok(())
            })
            .await;

        served.map_err(|error| AcpError::Protocol {
            message: error.to_string(),
        })
    }
    .boxed();

    Ok(AgentConnection {
        book,
        client: AgentClient { commands },
        session_id,
        driver,
    })
}
