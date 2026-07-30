use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, ListSessionsRequest, NewSessionRequest, PromptRequest,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionId, SessionNotification, SetSessionConfigOptionRequest,
    TextContent,
};
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, ConnectionTo, LineDirection};
use futures::channel::{mpsc, oneshot};
use futures::future::{Either, select};
use futures::stream::FuturesUnordered;
use futures::{FutureExt, StreamExt};
use serde_json::Value;

use crate::commands::{AgentClient, Command};
use crate::config::{ConfigControl, controls};
use crate::desk::PermissionDesk;
use crate::error::{AcpError, Result};
use crate::permission::{Decision, decide};
use crate::program::resolve_program;
use crate::run_slot::RunSlot;
use crate::session::{AgentConnection, AgentSpawn, OpenedSession, SessionEntry};
use crate::sessions::SessionBook;
use crate::stderr::StderrLog;
use crate::trace::{open_trace, trace};

const UNREADABLE: &str = "the agent reported a stop reason the client could not read";
const CANCELLED: &str = "cancelled";
const UNKNOWN: &str = "the session named by this request is not one this client opened";

/// 主循环这一步在处理什么。
enum Step {
    /// 有人下了一条命令，或者命令流断了。
    Asked(Option<Command>),
    /// 一件在飞的事回来了。
    Settled(Settled),
}

/// 一件做完了的事，以及它落回主循环才能做完的那一半。
///
/// 会话册子只有主循环一个持有者，所以要改它的事都在这里交回去 —— 换来的是
/// 一张锁都不需要。
enum Settled {
    /// 自己就答完了。
    Done,
    Opened {
        opened: Result<Started>,
        reply: oneshot::Sender<Result<OpenedSession>>,
    },
    Selected {
        session_id: String,
        outcome: Result<Vec<ConfigControl>>,
        reply: oneshot::Sender<Result<Vec<ConfigControl>>>,
    },
    Turn {
        asked: String,
        ended: Ended,
        slot: RunSlot,
        reply: oneshot::Sender<Result<String>>,
    },
}

/// 一条刚开出来的会话。
struct Started {
    name: String,
    named: SessionId,
    offered: Vec<ConfigControl>,
}

/// 一轮是怎么结束的。
///
/// 协议的类型到这里为止：往后走的是已经读得懂的三种结局。
enum Ended {
    Cancelled,
    Finished(String),
    Failed(String),
}

/// Spawns the agent, creates one session, and keeps the connection open.
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
/// Fails when the program cannot be found on the search path, or when the
/// process cannot be started.
pub fn connect(spawn: AgentSpawn, slot: RunSlot, desk: PermissionDesk) -> Result<AgentConnection> {
    let AgentSpawn {
        program,
        args,
        cwd,
        env,
    } = spawn;

    // 解析规则连同它的病历都在 program.rs 里，provider CLI 那条路径读的是
    // 同一个函数 —— 同一个程序不该有两套找法。
    let resolved = resolve_program(&program)?;

    /* 启动配置是 SDK 自己的类型，不是 MCP 的 wire schema。1.x 借用了 McpServerStdio，
    于是这里得先造一个没人看的服务器名、再往一个 #[non_exhaustive] 结构体的 Vec 里
    逐条 push EnvVariable。2.0 换成 AcpAgentConfig 之后这些全部消失：env 是一张字符
    串表，Vec<(String, String)> 直接喂得进去。

    仍然是直接构造，而不是先拼一行命令再让 from_str 用 shell 词法把它切回来 ——
    那一趟往返是有损的：绝对路径的反斜杠会被当成转义符，带空格的路径会被切断。

    command 收的是 impl Into<PathBuf>，which 交回来的就是 PathBuf，无需再转。 */
    let agent = AcpAgent::new(AcpAgentConfig::new(resolved).args(args).envs(env));

    // What the agent says for itself. A provider rejection is reported on the
    // process error stream and the turn still ends normally, so this is the
    // only account of such a turn there is. The SDK offers the stream through
    // its own observer, which is why nothing here reads a pipe.
    let diagnostics = StderrLog::new();
    let observed = diagnostics.clone();

    // The observer sees both halves. Only the standard error half was kept,
    // which left the protocol itself unobservable from inside the client.
    let traced = open_trace();

    let agent = agent.with_debug(move |line, direction| {
        let is_stderr = direction == LineDirection::Stderr;

        if let Some(sink) = traced.as_deref() {
            trace(sink, if is_stderr { "err " } else { "wire" }, line);
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
    let ledger = book.clone();
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
                let offered = match session.config_options.as_deref() {
                    Some(offered) => controls(offered),
                    None => Vec::new(),
                };
                let primary = session.session_id.clone();

                // 每条会话一份：会话名 → (协议 id, 它自己的选择器)。
                //
                // 选择器属于会话而不属于连接：一条会话选了哪个模型，
                // 说明不了另一条选了什么。
                let mut sessions = HashMap::new();
                sessions.insert(primary.to_string(), (primary.clone(), offered));

                // The book is what turns a name into a slot, so this session
                // is entered in it before any frame of it can arrive.
                //
                // A book that cannot be written to could never record this
                // session, so its name is never published: the caller is
                // told by the dropped sender instead of being handed a
                // session that quietly records nothing.
                if first.adopt(&primary.to_string(), slot).is_err() {
                    return Ok(());
                }

                // Nobody may still be waiting for the identifier, and that is
                // not a failure of the session.
                let _ignored = ready.send(primary.to_string());

                /*
                 * 在飞的每一件事各是一个未来，一起被推进。
                 *
                 * 此前这里是一个只等一个请求的 select：一轮进行中收到的每一条
                 * 命令都得在那个 select 的分支里手写分发，而"这个任务正在等一
                 * 个回应"就成了拒绝其他所有命令的理由 —— BUSY、AWAITING、
                 * CHANGING 三条拒绝，没有一条来自协议。
                 *
                 * SDK 自己说得很清楚（concepts/ordering.rs）：block_task 不占用
                 * 派发循环，foreground future 里同时挂多个请求正是它的用法。
                 * 于是主循环只剩两件事：收命令、收结果。
                 *
                 * 用一组未来而不是 spawn，是因为会话册子只有一个持有者时不需要
                 * 任何锁；要改它的事都由结果带回这里落账。
                 */
                let mut jobs: FuturesUnordered<Pin<Box<dyn Future<Output = Settled> + Send + '_>>> =
                    FuturesUnordered::new();

                /* 每条会话上正在飞的那一轮，以及叫停它的那根线。线一断就是取消。 */
                let mut flying: HashMap<String, oneshot::Sender<()>> = HashMap::new();

                let mut stopping = false;

                loop {
                    let step = if stopping {
                        // 停止之后不再收命令，只把已经在飞的事收完。
                        if jobs.is_empty() {
                            break;
                        }

                        Step::Settled(jobs.select_next_some().await)
                    } else {
                        futures::select! {
                            message = receiver.next() => Step::Asked(message),
                            settled = jobs.select_next_some() => Step::Settled(settled),
                        }
                    };

                    match step {
                        // 命令流断了，和明说停止是同一件事。
                        Step::Asked(None | Some(Command::Shutdown)) => {
                            stopping = true;

                            /* 每根叫停线一断，那一轮就收到取消。丢掉请求正是
                            SDK 发出协议取消通知的方式，所以 agent 是被告知的。 */
                            flying.clear();
                        }
                        Step::Asked(Some(Command::Cancel { session_id })) => {
                            let _stopped = flying.remove(&session_id);
                        }
                        Step::Asked(Some(Command::NewSession { cwd, reply })) => {
                            jobs.push(Box::pin(open_session(
                                &connection,
                                ledger.clone(),
                                cwd,
                                reply,
                            )));
                        }
                        Step::Asked(Some(Command::Sessions { reply })) => {
                            jobs.push(Box::pin(list_sessions(&connection, reply)));
                        }
                        // 读一份列表不需要问 agent，就地答。
                        Step::Asked(Some(Command::Selectors { session_id, reply })) => {
                            let answer = match sessions.get(&session_id) {
                                Some((_named, offered)) => Ok(offered.clone()),
                                None => Err(AcpError::Protocol {
                                    message: UNKNOWN.to_owned(),
                                }),
                            };

                            let _ignored = reply.send(answer);
                        }
                        Step::Asked(Some(Command::Select {
                            session_id,
                            config_id,
                            value,
                            reply,
                        })) => {
                            let Some((named, _offered)) = sessions.get(&session_id) else {
                                let _ignored = reply.send(Err(AcpError::Protocol {
                                    message: UNKNOWN.to_owned(),
                                }));

                                continue;
                            };

                            jobs.push(Box::pin(change_selector(
                                &connection,
                                session_id,
                                named.clone(),
                                config_id,
                                value,
                                reply,
                            )));
                        }
                        Step::Asked(Some(Command::Prompt {
                            session_id,
                            text,
                            recorder,
                            reply,
                        })) => {
                            // 这一轮属于哪条会话，就问哪条会话要它的协议 id 和
                            // 它的槽。接收路径按名字分发的功夫，不能在这里被抵消。
                            let Some((named, _offered)) = sessions.get(&session_id) else {
                                let _ignored = reply.send(Err(AcpError::Protocol {
                                    message: UNKNOWN.to_owned(),
                                }));

                                continue;
                            };
                            let named = named.clone();

                            let Ok(Some(turn)) = ledger.slot(&session_id) else {
                                let _ignored = reply.send(Err(AcpError::Protocol {
                                    message: UNKNOWN.to_owned(),
                                }));

                                continue;
                            };

                            /* 一条会话同时只走一轮 —— 这是记录槽自己的规矩，
                            而它的范围正好是一条会话。"整条连接只许一轮"那道
                            闸门已经没有了：它拦下的是别的对话。 */
                            if let Err(error) = turn.install(*recorder) {
                                let _ignored = reply.send(Err(error));

                                continue;
                            }

                            /* 错误流是整个进程的，不是某一轮的。此刻没有别的轮
                            在飞，这一轮才有资格把它清空并当成自己的。 */
                            if flying.is_empty() {
                                diagnostics.clear();
                            }

                            // The prompt is recorded before it is sent, so a turn
                            // that fails on the first request still shows what was
                            // asked.
                            let _routed = turn.record(|recorder| {
                                recorder.record_run_started(&session_id, &text);
                            });

                            let (stop, stopped) = oneshot::channel::<()>();

                            flying.insert(session_id.clone(), stop);

                            jobs.push(Box::pin(run_turn(
                                &connection,
                                session_id,
                                named,
                                text,
                                turn,
                                stopped,
                                reply,
                            )));
                        }
                        Step::Settled(Settled::Done) => {}
                        Step::Settled(Settled::Opened { opened, reply }) => {
                            let answer = opened.map(
                                |Started {
                                     name,
                                     named,
                                     offered,
                                 }| {
                                    sessions.insert(name.clone(), (named, offered.clone()));

                                    OpenedSession {
                                        session_id: name,
                                        selectors: offered,
                                    }
                                },
                            );

                            let _ignored = reply.send(answer);
                        }
                        Step::Settled(Settled::Selected {
                            session_id,
                            outcome,
                            reply,
                        }) => {
                            // 只改这一条会话的那一份。
                            if let Ok(offered) = &outcome
                                && let Some(held) = sessions.get_mut(&session_id)
                            {
                                held.1.clone_from(offered);
                            }

                            let _ignored = reply.send(outcome);
                        }
                        Step::Settled(Settled::Turn {
                            asked,
                            ended,
                            slot: turn,
                            reply,
                        }) => {
                            let _stopped = flying.remove(&asked);

                            let Ok(Some(mut recorder)) = turn.take() else {
                                let _ignored = reply.send(Err(AcpError::Poisoned));

                                continue;
                            };

                            /* 这一轮结束了，就没人会回答它还开着的那些问题。
                            放掉的只有它自己的：此刻别的会话可能正等着人回答。
                            此前这里清的是整张桌子 —— 那是"一条连接只可能有
                            一轮"时代的写法，几轮同时在飞时它会替别人把问题
                            也一并取消掉。 */
                            desk.abandon(&recorder.outstanding_permissions());
                            recorder.record_pending_cancelled();

                            /* 错误流是整条连接共有的：几轮同时在飞时，它不属于
                            其中任何一轮，于是谁也不拿它来解释自己。 */
                            if flying.is_empty() {
                                recorder.set_diagnostics(diagnostics.tail());
                            }

                            let settled = match ended {
                                Ended::Cancelled => {
                                    recorder.record_run_cancelled();

                                    Ok(CANCELLED.to_owned())
                                }
                                Ended::Failed(message) => {
                                    recorder.record_run_failed(&message);

                                    Err(AcpError::Protocol { message })
                                }
                                Ended::Finished(reason) => {
                                    recorder.record_run_finished(&reason);

                                    Ok(reason)
                                }
                            };

                            // A write that failed mid-turn could not be reported at
                            // the time, so the turn only counts as successful once
                            // the recorder confirms it.
                            let settled = match recorder.take_failure() {
                                Some(failure) => Err(failure),
                                None => settled,
                            };

                            let _ignored = reply.send(settled);
                        }
                    }
                }

                /* 连接要走了，桌上再没有人会来回答。 */
                desk.clear();

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
        client: AgentClient::new(commands),
        session_id,
        driver,
    })
}

/// Opens one more session on a connection that is already running.
async fn open_session(
    connection: &ConnectionTo<Agent>,
    ledger: SessionBook,
    cwd: PathBuf,
    reply: oneshot::Sender<Result<OpenedSession>>,
) -> Settled {
    let started = connection
        .send_request(NewSessionRequest::new(cwd))
        .block_task()
        .await;

    let opened = match started {
        Err(error) => Err(AcpError::Protocol {
            message: error.to_string(),
        }),
        Ok(session) => {
            let name = session.session_id.to_string();
            let offered = match session.config_options.as_deref() {
                Some(options) => controls(options),
                None => Vec::new(),
            };

            // The session is entered in the book before its name is handed
            // out, so its first frame has somewhere to go.
            ledger.open(&name).map(|_slot| Started {
                name,
                named: session.session_id.clone(),
                offered,
            })
        }
    };

    Settled::Opened { opened, reply }
}

/// Asks the agent for its own list of sessions.
async fn list_sessions(
    connection: &ConnectionTo<Agent>,
    reply: oneshot::Sender<Result<Vec<SessionEntry>>>,
) -> Settled {
    let listed = connection
        .send_request(ListSessionsRequest::new())
        .block_task()
        .await;

    let answer = match listed {
        Ok(response) => Ok(response
            .sessions
            .iter()
            .map(|info| SessionEntry {
                session_id: info.session_id.to_string(),
                title: info.title.clone(),
                updated_at: info.updated_at.clone(),
            })
            .collect()),
        Err(error) => Err(AcpError::Protocol {
            message: error.to_string(),
        }),
    };

    let _ignored = reply.send(answer);

    Settled::Done
}

/// Changes one selector on one session.
async fn change_selector(
    connection: &ConnectionTo<Agent>,
    session_id: String,
    named: SessionId,
    config_id: String,
    value: String,
    reply: oneshot::Sender<Result<Vec<ConfigControl>>>,
) -> Settled {
    let changed = connection
        .send_request(SetSessionConfigOptionRequest::new(
            named,
            config_id,
            // The request takes a value the schema can convert, and it
            // converts a borrowed string, not an owned one.
            value.as_str(),
        ))
        .block_task()
        .await;

    let outcome = match changed {
        Ok(response) => Ok(controls(&response.config_options)),
        Err(error) => Err(AcpError::Protocol {
            message: error.to_string(),
        }),
    };

    Settled::Selected {
        session_id,
        outcome,
        reply,
    }
}

/// Walks one turn from the prompt to its end.
///
/// 这一轮的取消是它自己的一根线，不是整条连接的一个状态。
async fn run_turn(
    connection: &ConnectionTo<Agent>,
    asked: String,
    named: SessionId,
    text: String,
    slot: RunSlot,
    stopped: oneshot::Receiver<()>,
    reply: oneshot::Sender<Result<String>>,
) -> Settled {
    let pending = Box::pin(
        connection
            .send_request(PromptRequest::new(
                named,
                vec![ContentBlock::Text(TextContent::new(text))],
            ))
            .block_task(),
    );

    let ended = match select(pending, stopped).await {
        Either::Left((answered, _stop)) => match answered {
            Err(error) => Ended::Failed(error.to_string()),
            // The wire form is the contract, so the stop reason is taken from
            // serialisation rather than from a hand-written mapping.
            Ok(response) => match serde_json::to_value(response.stop_reason) {
                Ok(Value::String(reason)) => Ended::Finished(reason),
                _unreadable => Ended::Failed(UNREADABLE.to_owned()),
            },
        },
        // Dropping the request handle before the response arrives is how the
        // SDK sends the protocol's cancellation notification, so the agent is
        // told rather than abandoned.
        Either::Right((_asked_to_stop, in_flight)) => {
            drop(in_flight);

            Ended::Cancelled
        }
    };

    Settled::Turn {
        asked,
        ended,
        slot,
        reply,
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
