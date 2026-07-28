//! What recording a run requires of a store.
//!
//! Nine methods, because the recorder calls nine. The names are the
//! runtime's own rather than the store's: a trait that repeats the
//! vocabulary of one implementation is not an abstraction, it is a
//! forwarding layer with extra steps.
//!
//! Nothing here mentions a connection, a lock or a file. How the log is
//! shared is a deployment question, answered by whoever implements this.

use serde_json::Value;
use uuid::Uuid;

/// Whatever went wrong on the way to durability.
///
/// The runtime cannot act on the difference between a busy database and a
/// poisoned lock — either way the frame is not written and the turn has
/// failed — so the detail is carried as text and reported, not matched on.
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct LogError {
    message: String,
}

impl LogError {
    /// Reports a failed write in the implementation's own words.
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

/// The result type every log operation returns.
pub type LogResult<T> = std::result::Result<T, LogError>;

/// How a run ended.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RunOutcome {
    /// The agent stopped on its own terms.
    Finished,
    /// The user stopped it.
    Cancelled,
    /// It ended in a failure.
    Failed,
}

/// Where a tool call has got to.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ToolCallState {
    /// Announced, not started.
    Pending,
    /// Running.
    InProgress,
    /// Done.
    Completed,
    /// Failed.
    Failed,
}

/// What a permission request was settled with.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PermissionAnswer {
    /// The user allowed it.
    Allowed,
    /// The user refused it.
    Denied,
    /// Nobody answered before the turn ended.
    Cancelled,
}

/// A tool call as the log has it, reduced to what the runtime reads back.
#[derive(Clone, Debug)]
pub struct RecordedToolCall {
    /// The identifier the agent used.
    pub id: String,
    /// The title it was announced or renamed with.
    pub title: String,
}

/// A permission request that is still waiting for an answer.
#[derive(Clone, Debug)]
pub struct OutstandingPermission {
    /// The request the answer would settle.
    pub request_id: String,
}

/// The durable log a run is recorded into, and the projections kept in step
/// with it.
///
/// Implementations are shared across threads and take `&self`, so any
/// serialisation they need is theirs to arrange.
pub trait RunLog: Send {
    /// Appends one frame at `seq` within the run.
    ///
    /// # Errors
    ///
    /// Fails when the frame cannot be made durable.
    fn append_event(&self, run_id: Uuid, seq: i64, kind: &str, frame: &Value) -> LogResult<()>;

    /// Closes the run with how it ended and the account given.
    ///
    /// # Errors
    ///
    /// Fails when the run row cannot be written.
    fn finish_run(&self, run_id: Uuid, outcome: RunOutcome, detail: Option<&str>)
    -> LogResult<()>;

    /// Records a tool call the agent has just announced.
    ///
    /// # Errors
    ///
    /// Fails when the projection cannot be written.
    fn apply_tool_call(
        &self,
        run_id: Uuid,
        tool_call_id: &str,
        title: &str,
        kind: &str,
        state: ToolCallState,
    ) -> LogResult<()>;

    /// Moves a tool call on, optionally retitling it. Answers whether the
    /// call was known.
    ///
    /// # Errors
    ///
    /// Fails when the projection cannot be written.
    fn update_tool_call(
        &self,
        run_id: Uuid,
        tool_call_id: &str,
        state: ToolCallState,
        title: Option<&str>,
    ) -> LogResult<bool>;

    /// Retitles a tool call. Answers whether the call was known.
    ///
    /// # Errors
    ///
    /// Fails when the projection cannot be written.
    fn rename_tool_call(&self, run_id: Uuid, tool_call_id: &str, title: &str) -> LogResult<bool>;

    /// Records that the agent is blocked on a permission request.
    ///
    /// # Errors
    ///
    /// Fails when the request cannot be written.
    fn record_permission_request(
        &self,
        run_id: Uuid,
        request_id: &str,
        tool_call_id: Option<&str>,
    ) -> LogResult<()>;

    /// Settles a request. Answers whether it was still outstanding.
    ///
    /// # Errors
    ///
    /// Fails when the answer cannot be written.
    fn resolve_permission(&self, request_id: &str, answer: PermissionAnswer) -> LogResult<bool>;

    /// Every request in this run still waiting for an answer.
    ///
    /// # Errors
    ///
    /// Fails when the requests cannot be read.
    fn outstanding_permissions(&self, run_id: Uuid) -> LogResult<Vec<OutstandingPermission>>;

    /// Every tool call recorded in this run.
    ///
    /// # Errors
    ///
    /// Fails when the projection cannot be read.
    fn tool_calls(&self, run_id: Uuid) -> LogResult<Vec<RecordedToolCall>>;
}
