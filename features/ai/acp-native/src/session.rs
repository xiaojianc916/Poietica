use std::fmt;
use std::path::PathBuf;
use std::str::FromStr;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, NewSessionRequest, PromptRequest, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionNotification, TextContent,
};
use agent_client_protocol::{AcpAgent, Agent, ConnectionTo};
use futures::channel::{mpsc, oneshot};
use futures::future::{select, BoxFuture, Either};
use futures::{FutureExt, StreamExt};
use serde_json::Value;

use crate::error::{AcpError, Result};
use crate::permission::{decide, Decision};
use crate::recorder::Recorder;
use crate::run_slot::RunSlot;

const BUSY: &str = "a turn is already in flight on this session";
const GONE: &str = "the agent connection is no longer running";
const UNREADABLE: &str = "the agent reported a stop reason the client could not read";
const CANCELLED: &str = "cancelled";

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
        recorder: Recorder,
        reply: oneshot::Sender<Result<String>>,
    },
    Cancel,
    Shutdown,
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
            recorder,
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

/// Spawns the agent, creates one session, and keeps it open for many turns.
///
/// Updates are routed through the slot: a turn installs its recorder for the
/// duration of the run, so a notification that arrives between turns is dropped
/// instead of being attributed to the run that came before it.
///
/// # Errors
///
/// Fails when the command line cannot be turned into a process.
pub fn connect(spawn: AgentSpawn, slot: RunSlot) -> Result<AgentConnection> {
    let AgentSpawn { command, cwd } = spawn;

    let agent = AcpAgent::from_str(&command).map_err(|error| AcpError::Spawn {
        message: error.to_string(),
    })?;

    let (commands, receiver) = mpsc::unbounded::<Command>();
    let (ready, session_id) = oneshot::channel::<String>();

    let updates = slot.clone();
    let permissions = slot.clone();

    let driver = async move {
        let served = agent_client_protocol::Client
            .builder()
            .name("poietica")
            .on_receive_notification(
                async move |notification: SessionNotification, _cx| {
                    let _routed = updates.record(|recorder| {
                        recorder.record_session_update(&notification);
                    });

                    Ok(())
                },
                agent_client_protocol::on_receive_notification!(),
            )
            .on_receive_request(
                async move |request: RequestPermissionRequest, responder, _connection| {
                    let decision = decide(&request);

                    let _routed = permissions.record(|recorder| {
                        recorder.record_permission(&request, &decision);
                    });

                    match decision {
                        Decision::Reject(option_id) => {
                            responder.respond(RequestPermissionResponse::new(
                                RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                                    option_id,
                                )),
                            ))
                        }
                        Decision::Cancel => responder.respond(RequestPermissionResponse::new(
                            RequestPermissionOutcome::Cancelled,
                        )),
                    }
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
                let session_id = session.session_id.clone();

                // Nobody may still be waiting for the identifier, and that is
                // not a failure of the session.
                let _ignored = ready.send(session_id.to_string());

                'commands: loop {
                    let Some(message) = receiver.next().await else {
                        break 'commands;
                    };

                    let (text, recorder, reply) = match message {
                        Command::Shutdown => break 'commands,
                        // Nothing is in flight, so there is nothing to stop.
                        Command::Cancel => continue 'commands,
                        Command::Prompt {
                            text,
                            recorder,
                            reply,
                        } => (text, recorder, reply),
                    };

                    // One turn at a time. A second prompt is refused here
                    // rather than allowed to interleave two runs on one log.
                    if let Err(error) = slot.install(recorder) {
                        let _ignored = reply.send(Err(error));

                        continue 'commands;
                    }

                    let _routed = slot.record(|recorder| {
                        recorder.record_run_started(&session_id.to_string());
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
                            },
                        }
                    };

                    let Ok(Some(mut recorder)) = slot.take() else {
                        let _ignored = reply.send(Err(AcpError::RecorderPoisoned));

                        if stopping {
                            break 'commands;
                        }

                        continue 'commands;
                    };

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
                            match serde_json::to_value(&response.stop_reason) {
                                Ok(Value::String(reason)) => {
                                    recorder.record_run_finished(&reason);

                                    Ok(reason)
                                }
                                _ => {
                                    let message = UNREADABLE.to_owned();
                                    recorder.record_run_failed(&message);

                                    Err(AcpError::Protocol { message })
                                }
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

                    let _ignored = reply.send(settled);

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
        client: AgentClient { commands },
        session_id,
        driver,
    })
}
