//! Where the encrypted store meets what recording a run requires of one.
//!
//! The orphan rule puts this here, and so would the architecture: the
//! runtime crate defines the trait, the persistence crate defines the store,
//! and this is the only place that is permitted to have heard of both.
//!
//! The lock lives here too. A recorder that took it was a recorder that knew
//! its log was shared, which is a fact about how this application is
//! assembled and not about recording a run.

use std::sync::{Arc, Mutex};

use poietica_agent_persistence_native::{
    AgentStore, PermissionOutcome, Result as StoreResult, RunStatus, ToolCallStatus,
};
use poietica_agent_runtime_native::{
    LogError, LogResult, OutstandingPermission, PermissionAnswer, RecordedToolCall, RunLog,
    RunOutcome, ToolCallState,
};
use serde_json::Value;
use uuid::Uuid;

const POISONED: &str = "the encrypted store was left locked by a panicking task";

/// The application's one store, presented as a run log.
pub(crate) struct SharedLog {
    store: Arc<Mutex<AgentStore>>,
}

impl SharedLog {
    /// Presents an existing share of the store as a log.
    pub(crate) const fn new(store: Arc<Mutex<AgentStore>>) -> Self {
        Self { store }
    }

    /// Takes the store for the length of one statement.
    fn with<T>(&self, act: impl FnOnce(&AgentStore) -> StoreResult<T>) -> LogResult<T> {
        let guard = self
            .store
            .lock()
            .map_err(|_poisoned| LogError::new(POISONED))?;

        act(&guard).map_err(|failure| LogError::new(failure.to_string()))
    }
}

/// The runtime's words, in the store's.
const fn status(outcome: RunOutcome) -> RunStatus {
    match outcome {
        RunOutcome::Finished => RunStatus::Finished,
        RunOutcome::Cancelled => RunStatus::Cancelled,
        RunOutcome::Failed => RunStatus::Failed,
    }
}

const fn state(value: ToolCallState) -> ToolCallStatus {
    match value {
        ToolCallState::Pending => ToolCallStatus::Pending,
        ToolCallState::InProgress => ToolCallStatus::InProgress,
        ToolCallState::Completed => ToolCallStatus::Completed,
        ToolCallState::Failed => ToolCallStatus::Failed,
    }
}

const fn answer(value: PermissionAnswer) -> PermissionOutcome {
    match value {
        PermissionAnswer::Allowed => PermissionOutcome::Allowed,
        PermissionAnswer::Denied => PermissionOutcome::Denied,
        PermissionAnswer::Cancelled => PermissionOutcome::Cancelled,
    }
}

impl RunLog for SharedLog {
    fn append_event(&self, run_id: Uuid, seq: i64, kind: &str, frame: &Value) -> LogResult<()> {
        self.with(|store| store.append_event(run_id, seq, kind, frame))
    }

    fn finish_run(
        &self,
        run_id: Uuid,
        outcome: RunOutcome,
        detail: Option<&str>,
    ) -> LogResult<()> {
        self.with(|store| store.finish_run(run_id, status(outcome), detail))
    }

    fn apply_tool_call(
        &self,
        run_id: Uuid,
        tool_call_id: &str,
        title: &str,
        kind: &str,
        value: ToolCallState,
    ) -> LogResult<()> {
        self.with(|store| store.apply_tool_call(run_id, tool_call_id, title, kind, state(value)))
    }

    fn update_tool_call(
        &self,
        run_id: Uuid,
        tool_call_id: &str,
        value: ToolCallState,
        title: Option<&str>,
    ) -> LogResult<bool> {
        self.with(|store| store.update_tool_call(run_id, tool_call_id, state(value), title))
    }

    fn rename_tool_call(&self, run_id: Uuid, tool_call_id: &str, title: &str) -> LogResult<bool> {
        self.with(|store| store.rename_tool_call(run_id, tool_call_id, title))
    }

    fn record_permission_request(
        &self,
        run_id: Uuid,
        request_id: &str,
        tool_call_id: Option<&str>,
    ) -> LogResult<()> {
        self.with(|store| store.record_permission_request(run_id, request_id, tool_call_id))
    }

    fn resolve_permission(&self, request_id: &str, value: PermissionAnswer) -> LogResult<bool> {
        self.with(|store| store.resolve_permission(request_id, answer(value)))
    }

    fn outstanding_permissions(&self, run_id: Uuid) -> LogResult<Vec<OutstandingPermission>> {
        let pending = self.with(|store| store.pending_permissions(run_id))?;

        Ok(pending
            .into_iter()
            .map(|record| OutstandingPermission {
                request_id: record.request_id,
            })
            .collect())
    }

    fn tool_calls(&self, run_id: Uuid) -> LogResult<Vec<RecordedToolCall>> {
        let calls = self.with(|store| store.tool_calls_for_run(run_id))?;

        Ok(calls
            .into_iter()
            .map(|call| RecordedToolCall {
                id: call.id,
                title: call.title,
            })
            .collect())
    }
}
