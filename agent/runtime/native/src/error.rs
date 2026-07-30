use crate::run_log::LogError;

/// 这一侧自己判定的拒绝。
///
/// 这三件事都不是 agent 说的，是请求发出去之前本侧就知道的。此前它们与 agent
/// 报回来的原因一样，被塞进 `Protocol` 的那个字符串字段里 —— 于是桌面层只能把
/// 它们和别的一起折成一句「应用操作失败」，而它们恰恰是三件用户自己能解决的事。
/// 给它们一个类型，桌面层才有可能分别说话。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// 这个会话号不是本次连接开出来的。
    UnknownSession,
    /// 驱动器已经停了，没有谁能收下这条命令。
    Gone,
    /// 这条会话上已经有一轮在飞。
    Busy,
}

/// Everything that can go wrong while driving an agent.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum AcpError {
    /// The log rejected a read or a write.
    #[error("the run log rejected an operation: {0}")]
    Log(#[from] LogError),
    /// A protocol payload could not be encoded for the log.
    #[error("a session update could not be encoded: {0}")]
    Encoding(#[from] serde_json::Error),
    /// The agent command could not be turned into a process.
    #[error("the agent command could not be started: {message}")]
    Spawn {
        /// What the process layer reported.
        message: String,
    },
    /// The connection to the agent failed.
    #[error("the agent connection failed: {message}")]
    Protocol {
        /// What the protocol layer reported.
        message: String,
    },
    /// 握手没能走完，一条会话都没开出来。
    ///
    /// 与 `Protocol` 分开，因为它发生在还没有任何东西可以承接失败的时刻：调用者
    /// 此刻手上只有一个等着会话名的通道，而那个通道此前只能传成功。
    #[error("the agent handshake failed: {message}")]
    Handshake {
        /// What the protocol layer reported.
        message: String,
    },
    /// A progress update named a tool call that was never announced.
    #[error("the agent updated an unannounced tool call: {tool_call_id}")]
    UnknownToolCall {
        /// The identifier the agent used.
        tool_call_id: String,
    },
    /// 这一侧拒绝了请求，它还没有被发出去。
    #[error("the request was refused before it was sent: {0:?}")]
    Refused(Refusal),
    /// A task panicked while holding the run slot.
    ///
    /// The slot is what routes an arriving update to the run it belongs to.
    /// A panic that leaves it locked has ended the turn either way; this is
    /// how that is reported rather than guessed at.
    #[error("the run slot was left locked by a panicking task")]
    Poisoned,
}

/// The result type used throughout this crate.
pub type Result<T> = core::result::Result<T, AcpError>;
