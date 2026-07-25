use poietica_ai_persistence_native::StoreError;

/// Everything that can go wrong while driving an agent.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum AcpError {
    /// The encrypted store rejected a read or a write.
    #[error("the encrypted store rejected an operation: {0}")]
    Store(#[from] StoreError),
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
    /// A task panicked while holding the recorder.
    #[error("the recorder was left locked by a panicking task")]
    RecorderPoisoned,
}

/// The result type used throughout this crate.
pub type Result<T> = std::result::Result<T, AcpError>;
