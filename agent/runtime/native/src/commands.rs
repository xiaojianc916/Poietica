use std::fmt;
use std::path::PathBuf;

use futures::channel::{mpsc, oneshot};

use crate::config::ConfigControl;
use crate::error::{AcpError, Result};
use crate::recorder::Recorder;
use crate::session::{OpenedSession, SessionEntry};

/// 驱动器不在了，没有谁能收下这条命令。
pub(crate) const GONE: &str = "the agent connection is no longer running";

/// What the driver is asked to do next.
///
/// 每一条都是一件事，而不是一个时段：驱动器把它变成一个自己的未来推进去，
/// 谁先回来谁先落账。此前它们是在一条命令流上排队的，于是"正在等一个回应"
/// 这件事本身，变成了拒绝其他所有命令的理由。
pub(crate) enum Command {
    /// Open one more session on the connection that is already running.
    NewSession {
        cwd: PathBuf,
        reply: oneshot::Sender<Result<OpenedSession>>,
    },
    /// Ask the agent which sessions it keeps, and what it calls them.
    Sessions {
        reply: oneshot::Sender<Result<Vec<SessionEntry>>>,
    },
    Prompt {
        /// The session this turn belongs to.
        ///
        /// 一条连接可以开很多条会话，agent 发回的每一帧都自报会话名。
        /// 提问也必须说出它是给哪一条的，否则它只能发给第一条。
        session_id: String,
        text: String,
        /// Boxed because a channel message is sized by its largest variant,
        /// and stopping a turn should not be charged for starting one.
        recorder: Box<Recorder>,
        reply: oneshot::Sender<Result<String>>,
    },
    /// 停掉这条会话上正在飞的那一轮，只停它。
    ///
    /// 一条连接同时开着多条会话，而现在它们可以同时在飞：不点名的取消
    /// 停掉的会是别人那一轮。
    Cancel {
        session_id: String,
    },
    Shutdown,
    /// Answers with the selectors that session is currently offering.
    Selectors {
        session_id: String,
        reply: oneshot::Sender<Result<Vec<ConfigControl>>>,
    },
    /// Asks the agent to change one selector on one session.
    Select {
        session_id: String,
        config_id: String,
        value: String,
        reply: oneshot::Sender<Result<Vec<ConfigControl>>>,
    },
}

/// A handle onto a live connection. Cheap to clone, safe to hold anywhere.
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
    /// The sending end of a driver's command stream.
    pub(crate) const fn new(commands: mpsc::UnboundedSender<Command>) -> Self {
        Self { commands }
    }

    /// Opens one more session on the running connection.
    ///
    /// # Errors
    ///
    /// Fails when the connection is gone, when the agent refuses to open a
    /// session, or when the book cannot record the one it opened.
    pub async fn new_session(&self, cwd: PathBuf) -> Result<OpenedSession> {
        let (reply, answer) = oneshot::channel();

        self.send(Command::NewSession { cwd, reply })?;

        answer.await.map_err(|_dropped| AcpError::Protocol {
            message: GONE.to_owned(),
        })?
    }

    /// Asks the agent which sessions it keeps, and what it calls them.
    ///
    /// The title is the agent's own, so it is the only honest source for
    /// one; a session it has not named yet reports none.
    ///
    /// # Errors
    ///
    /// Fails when the connection is gone or the agent refuses to list.
    pub async fn sessions(&self) -> Result<Vec<SessionEntry>> {
        let (reply, answer) = oneshot::channel();

        self.send(Command::Sessions { reply })?;

        answer.await.map_err(|_dropped| AcpError::Protocol {
            message: GONE.to_owned(),
        })?
    }

    /// Starts a turn, recording it with the recorder handed in.
    ///
    /// The answer resolves to the stop reason the agent reported once the turn
    /// is over. Every frame of the turn reaches the caller through the
    /// recorder's sink long before that, which is what the interface consumes.
    ///
    /// 一条会话同时只走一轮，那是它的记录槽的规矩；别的会话不受影响。
    ///
    /// # Errors
    ///
    /// Fails when the driver is no longer running.
    pub fn prompt(
        &self,
        session_id: String,
        text: String,
        recorder: Recorder,
    ) -> Result<oneshot::Receiver<Result<String>>> {
        let (reply, answer) = oneshot::channel();

        self.send(Command::Prompt {
            session_id,
            text,
            recorder: Box::new(recorder),
            reply,
        })?;

        Ok(answer)
    }

    /// Asks the agent to stop the turn in flight on one session.
    ///
    /// Cancellation is cooperative: the agent may still finish normally, and
    /// the turn's own answer reports which of the two happened.
    ///
    /// 停哪一条必须说出来。一条连接上有多条会话，而它们可以同时在飞。
    ///
    /// # Errors
    ///
    /// Fails when the driver is no longer running.
    pub fn cancel(&self, session_id: String) -> Result<()> {
        self.send(Command::Cancel { session_id })
    }

    /// Ends every session and lets the agent process exit.
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
    pub fn selectors(
        &self,
        session_id: String,
    ) -> Result<oneshot::Receiver<Result<Vec<ConfigControl>>>> {
        let (reply, answer) = oneshot::channel();

        self.send(Command::Selectors { session_id, reply })?;

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
        session_id: String,
        config_id: String,
        value: String,
    ) -> Result<oneshot::Receiver<Result<Vec<ConfigControl>>>> {
        let (reply, answer) = oneshot::channel();

        self.send(Command::Select {
            session_id,
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
