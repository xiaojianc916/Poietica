use thiserror::Error;

/// Everything that can go wrong when reading or writing agent state.
#[derive(Debug, Error)]
pub enum StoreError {
    /// The database rejected a statement.
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// The operating system credential store could not be reached.
    #[error("credential store error: {0}")]
    Keyring(#[from] keyring::v1::Error),

    /// The credential store held something that is not hexadecimal.
    #[error("the stored database key is not valid hexadecimal")]
    KeyEncoding(#[from] hex::FromHexError),

    /// The credential store held a key of the wrong size.
    #[error("the stored database key has {0} bytes, expected 32")]
    KeyLength(usize),

    /// The file exists but this key does not open it.
    #[error("the database could not be opened with the stored key")]
    WrongKey,

    /// A payload could not be encoded or decoded.
    #[error("payload error: {0}")]
    Json(#[from] serde_json::Error),

    /// The same sequence number arrived twice for one run.
    #[error("event {seq} already exists for run {run_id}")]
    DuplicateSeq {
        /// The run the duplicate belongs to.
        run_id: String,
        /// The sequence number that was already recorded.
        seq: i64,
    },

    /// A timestamp could not be formatted.
    #[error("timestamp error: {0}")]
    Time(#[from] time::error::Format),
}

/// Convenience alias used throughout the crate.
pub type Result<T> = std::result::Result<T, StoreError>;
