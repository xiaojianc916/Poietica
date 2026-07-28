use crate::run_log::LogError;

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
    /// A progress update named a tool call that was never announced.
    #[error("the agent updated an unannounced tool call: {tool_call_id}")]
    UnknownToolCall {
        /// The identifier the agent used.
        tool_call_id: String,
    },
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
