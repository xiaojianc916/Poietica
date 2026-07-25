use std::fmt;

use agent_client_protocol::schema::v1::{
    RequestPermissionRequest, SessionUpdate, ToolCallStatus as ProtocolToolCallStatus, ToolKind,
};
use poietica_ai_persistence_native::{
    AiStore, PermissionOutcome, RunStatus, ToolCallStatus,
};
use serde::Serialize;
use uuid::Uuid;

use crate::error::{AcpError, Result};
use crate::permission::Decision;

/// Log kind for the first event of a run.
pub const RUN_STARTED: &str = "run_started";
/// Log kind for a session update received from the agent.
pub const ACP_UPDATE: &str = "acp_update";
/// Log kind for a permission request the agent is blocked on.
pub const PERMISSION_REQUESTED: &str = "permission_requested";
/// Log kind for the answer given to a permission request.
pub const PERMISSION_RESOLVED: &str = "permission_resolved";
/// Log kind for a run that ended on the agent's terms.
pub const RUN_FINISHED: &str = "run_finished";
/// Log kind for a run that ended in a failure.
pub const RUN_FAILED: &str = "run_failed";

/// An event that is already durable and is now safe to forward.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedEvent {
    /// The run the event belongs to.
    pub run_id: String,
    /// Position within the run, starting at one.
    pub seq: i64,
    /// Discriminator, one of the constants in this module.
    pub kind: String,
    /// The payload as it was written.
    pub payload: serde_json::Value,
}

/// Writes the event log and keeps the projections in step with it.
///
/// The order inside every method is deliberate: append to the log, update the
/// projections, then forward. A consumer can therefore never observe an event
/// that would disappear on restart.
pub struct Recorder {
    store: AiStore,
    run_id: Uuid,
    next_seq: i64,
    sink: Box<dyn FnMut(&RecordedEvent) + Send>,
    failure: Option<AcpError>,
}

impl fmt::Debug for Recorder {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Recorder")
            .field("run_id", &self.run_id)
            .field("next_seq", &self.next_seq)
            .field("failed", &self.failure.is_some())
            .finish_non_exhaustive()
    }
}

impl Recorder {
    /// Starts recording a run, forwarding every durable event to `sink`.
    #[must_use]
    pub fn new(
        store: AiStore,
        run_id: Uuid,
        sink: Box<dyn FnMut(&RecordedEvent) + Send>,
    ) -> Self {
        Self {
            store,
            run_id,
            next_seq: 1,
            sink,
            failure: None,
        }
    }

    /// The run being recorded.
    #[must_use]
    pub const fn run_id(&self) -> Uuid {
        self.run_id
    }

    /// The store, for readers that want to replay or inspect projections.
    #[must_use]
    pub const fn store(&self) -> &AiStore {
        &self.store
    }

    /// Takes the first failure observed while recording, if there was one.
    ///
    /// Handlers cannot return our failures to the agent, so the driver asks for
    /// them here once the run is over.
    pub fn take_failure(&mut self) -> Option<AcpError> {
        self.failure.take()
    }

    /// Records that the run began.
    pub fn record_run_started(&mut self) {
        let outcome = self.append(RUN_STARTED, serde_json::Value::Null);
        self.remember(outcome);
    }

    /// Records a session update and projects it.
    pub fn record_session_update(&mut self, update: &SessionUpdate) {
        let outcome = self.persist_update(update);
        self.remember(outcome);
    }

    /// Records a permission request together with the answer given to it.
    ///
    /// The protocol does not expose the underlying request identifier to the
    /// handler, so the client mints one. It exists to correlate the request
    /// with its answer in the log, nothing more.
    pub fn record_permission(
        &mut self,
        request: &RequestPermissionRequest,
        decision: &Decision,
    ) -> String {
        let request_id = Uuid::now_v7().to_string();
        let tool_call_id = request.tool_call.tool_call_id.to_string();
        let outcome = self.persist_permission(&request_id, &tool_call_id, request, decision);

        self.remember(outcome);

        request_id
    }

    /// Records that the run ended on the agent's terms.
    pub fn record_run_finished(&mut self, stop_reason: &str) {
        let outcome = self.finish(RunStatus::Finished, RUN_FINISHED, stop_reason);
        self.remember(outcome);
    }

    /// Records that the run ended in a failure.
    pub fn record_run_failed(&mut self, message: &str) {
        let outcome = self.finish(RunStatus::Failed, RUN_FAILED, message);
        self.remember(outcome);
    }

    fn persist_update(&mut self, update: &SessionUpdate) -> Result<()> {
        let payload = serde_json::to_value(update)?;
        self.append(ACP_UPDATE, payload)?;
        self.project(update)
    }

    fn project(&mut self, update: &SessionUpdate) -> Result<()> {
        match update {
            SessionUpdate::ToolCall(call) => {
                // An unrecognised state is left out of the projection rather
                // than guessed at; the log still carries it verbatim.
                if let Some(status) = translate(call.status) {
                    self.store.apply_tool_call(
                        self.run_id,
                        &call.tool_call_id.to_string(),
                        &call.title,
                        kind_name(call.kind),
                        status,
                    )?;
                }
            }
            SessionUpdate::ToolCallUpdate(change) => {
                let tool_call_id = change.tool_call_id.to_string();

                let matched = if let Some(status) = change.fields.status.and_then(translate) {
                    self.store.update_tool_call(
                        self.run_id,
                        &tool_call_id,
                        status,
                        change.fields.title.as_deref(),
                    )?
                } else if let Some(title) = change.fields.title.as_deref() {
                    self.store.rename_tool_call(self.run_id, &tool_call_id, title)?
                } else {
                    true
                };

                if !matched {
                    return Err(AcpError::UnknownToolCall { tool_call_id });
                }
            }
            // The update enum grows with the protocol. Anything else is still
            // logged above; only the projections are selective.
            _ => {}
        }

        Ok(())
    }

    fn persist_permission(
        &mut self,
        request_id: &str,
        tool_call_id: &str,
        request: &RequestPermissionRequest,
        decision: &Decision,
    ) -> Result<()> {
        self.store
            .record_permission_request(self.run_id, request_id, Some(tool_call_id))?;
        self.append(
            PERMISSION_REQUESTED,
            serde_json::json!({
                "requestId": request_id,
                "toolCallId": tool_call_id,
                "options": serde_json::to_value(&request.options)?,
            }),
        )?;

        let outcome = match decision {
            Decision::Reject(_) => PermissionOutcome::Denied,
            Decision::Cancel => PermissionOutcome::Cancelled,
        };

        self.store.resolve_permission(request_id, outcome)?;
        self.append(
            PERMISSION_RESOLVED,
            serde_json::json!({
                "requestId": request_id,
                "outcome": outcome_name(outcome),
            }),
        )?;

        Ok(())
    }

    fn finish(&mut self, status: RunStatus, kind: &str, detail: &str) -> Result<()> {
        self.store.finish_run(self.run_id, status, Some(detail))?;
        self.append(kind, serde_json::json!({ "detail": detail }))
    }

    fn append(&mut self, kind: &str, payload: serde_json::Value) -> Result<()> {
        let seq = self.next_seq;

        self.store.append_event(self.run_id, seq, kind, &payload)?;
        self.next_seq = seq.saturating_add(1);

        let event = RecordedEvent {
            run_id: self.run_id.to_string(),
            seq,
            kind: kind.to_owned(),
            payload,
        };

        (self.sink)(&event);

        Ok(())
    }

    fn remember(&mut self, outcome: Result<()>) {
        if let Err(error) = outcome {
            if self.failure.is_none() {
                self.failure = Some(error);
            }
        }
    }
}

fn translate(status: ProtocolToolCallStatus) -> Option<ToolCallStatus> {
    match status {
        ProtocolToolCallStatus::Pending => Some(ToolCallStatus::Pending),
        ProtocolToolCallStatus::InProgress => Some(ToolCallStatus::InProgress),
        ProtocolToolCallStatus::Completed => Some(ToolCallStatus::Completed),
        ProtocolToolCallStatus::Failed => Some(ToolCallStatus::Failed),
        _ => None,
    }
}

fn kind_name(kind: ToolKind) -> &'static str {
    match kind {
        ToolKind::Read => "read",
        ToolKind::Edit => "edit",
        ToolKind::Delete => "delete",
        ToolKind::Move => "move",
        ToolKind::Search => "search",
        ToolKind::Execute => "execute",
        ToolKind::Think => "think",
        ToolKind::Fetch => "fetch",
        ToolKind::SwitchMode => "switch_mode",
        _ => "other",
    }
}

const fn outcome_name(outcome: PermissionOutcome) -> &'static str {
    match outcome {
        PermissionOutcome::Allowed => "allowed",
        PermissionOutcome::Denied => "denied",
        PermissionOutcome::Cancelled => "cancelled",
    }
}
