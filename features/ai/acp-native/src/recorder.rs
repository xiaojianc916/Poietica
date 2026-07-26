use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

use agent_client_protocol::schema::v1::{
    RequestPermissionRequest, SessionNotification, SessionUpdate,
    ToolCallStatus as ProtocolToolCallStatus, ToolKind,
};
use poietica_ai_persistence_native::{AiStore, PermissionOutcome, RunStatus, ToolCallStatus};
use serde::Serialize;
use serde_json::{Value, json};
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

/// The stop reason for a turn the user stopped, as the interface spells it.
const CANCELLED: &str = "cancelled";

/// A frame that is already durable and is now safe to forward.
///
/// `frame` is exactly what the interface consumes, and exactly what was
/// written to the log, so replaying a stored run cannot drift from watching a
/// live one. The run identifier stays outside the frame because it is a routing
/// concern of the transport, not part of the event contract.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedEvent {
    /// The run the frame belongs to.
    pub run_id: String,
    /// Position within the run, starting at one.
    pub seq: i64,
    /// Discriminator, one of the constants in this module.
    pub kind: String,
    /// The frame as the interface receives it.
    pub frame: Value,
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
    /// What the agent said on its own error stream during this run.
    diagnostics: String,
    /// How many session updates this run carried.
    ///
    /// A run that carried none said nothing through the protocol, which is
    /// the only case where its error stream is the account of the turn.
    updates: u32,
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
    /// Starts recording a run, forwarding every durable frame to `sink`.
    #[must_use]
    pub fn new(store: AiStore, run_id: Uuid, sink: Box<dyn FnMut(&RecordedEvent) + Send>) -> Self {
        Self {
            store,
            run_id,
            next_seq: 1,
            sink,
            failure: None,
            diagnostics: String::new(),
            updates: 0,
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

    /// Hands over what the agent said on its own error stream.
    ///
    /// Recorded with the end of the turn rather than as it arrives: the
    /// stream is not part of the protocol, it has no sequence of its own,
    /// and interleaving it with real frames would invent an order.
    pub fn set_diagnostics(&mut self, text: String) {
        self.diagnostics = text;
    }

    /// Takes the first failure observed while recording, if there was one.
    ///
    /// Handlers cannot return our failures to the agent, so the driver asks for
    /// them here once the run is over.
    pub fn take_failure(&mut self) -> Option<AcpError> {
        self.failure.take()
    }

    /// Records that the run began, and what was asked.
    ///
    /// The prompt belongs in the log because the interface has to show it, and
    /// an agent is under no obligation to echo it back. Recording it here is
    /// what makes a replayed run show the same conversation as a live one.
    pub fn record_run_started(&mut self, session_id: &str, prompt: &str) {
        let outcome = self.append(
            RUN_STARTED,
            json!({ "sessionId": session_id, "prompt": prompt }),
        );
        self.remember(outcome);
    }

    /// Records a session notification and projects it.
    pub fn record_session_update(&mut self, notification: &SessionNotification) {
        let outcome = self.persist_update(notification);
        self.remember(outcome);
    }

    /// Records a permission request the agent is now blocked on.
    ///
    /// The protocol does not expose the underlying request identifier to the
    /// handler, so the client mints one. It exists to correlate the request
    /// with its answer, nothing more.
    pub fn record_permission_requested(&mut self, request: &RequestPermissionRequest) -> String {
        let request_id = Uuid::now_v7().to_string();
        let tool_call_id = request.tool_call.tool_call_id.to_string();
        let outcome = self.persist_request(&request_id, &tool_call_id, request);

        self.remember(outcome);

        request_id
    }

    /// Records the answer a permission request was settled with.
    pub fn record_permission_resolved(&mut self, request_id: &str, decision: &Decision) {
        let outcome = self.persist_resolution(request_id, decision);
        self.remember(outcome);
    }

    /// Records a request and its answer in one step, for the paths that need
    /// no human: a request arriving outside a turn, or an unusable desk.
    pub fn record_permission(
        &mut self,
        request: &RequestPermissionRequest,
        decision: &Decision,
    ) -> String {
        let request_id = self.record_permission_requested(request);
        self.record_permission_resolved(&request_id, decision);

        request_id
    }

    /// Settles every request still outstanding when the turn ended.
    ///
    /// Their handlers are being abandoned, and an abandoned handler can no
    /// longer record anything, so the log would otherwise keep a request that
    /// is permanently unanswered.
    pub fn record_pending_cancelled(&mut self) {
        let pending = match self.store.pending_permissions(self.run_id) {
            Ok(pending) => pending,
            Err(error) => {
                self.remember(Err(error.into()));

                return;
            }
        };

        for record in pending {
            self.record_permission_resolved(&record.request_id, &Decision::Cancel);
        }
    }

    /// Records that the run ended on the agent's terms.
    pub fn record_run_finished(&mut self, stop_reason: &str) {
        let outcome = self.finish(
            RunStatus::Finished,
            RUN_FINISHED,
            json!({ "stopReason": stop_reason }),
            stop_reason,
        );
        self.remember(outcome);
    }

    /// Records that the user stopped the run.
    ///
    /// The frame is a normal end of turn carrying the protocol's own cancelled
    /// stop reason, because that is what the interface validates. The run row
    /// is marked cancelled rather than finished, because that is what happened.
    pub fn record_run_cancelled(&mut self) {
        let outcome = self.finish(
            RunStatus::Cancelled,
            RUN_FINISHED,
            json!({ "stopReason": CANCELLED }),
            CANCELLED,
        );
        self.remember(outcome);
    }

    /// Records that the run ended in a failure.
    pub fn record_run_failed(&mut self, message: &str) {
        let outcome = self.finish(
            RunStatus::Failed,
            RUN_FAILED,
            json!({ "message": message }),
            message,
        );
        self.remember(outcome);
    }

    fn persist_update(&mut self, notification: &SessionNotification) -> Result<()> {
        self.updates = self.updates.saturating_add(1);

        let mut update = serde_json::to_value(&notification.update)?;

        // The boundary validator treats an absent field and a null field
        // differently, and an optional protocol field may be encoded either
        // way. Removing nulls satisfies it without depending on which.
        prune_nulls(&mut update);

        // A tool call announcement must arrive complete. The serialiser omits
        // fields holding the protocol's default value, and a pending call is
        // the default, so the very first frame of every tool call would
        // otherwise be rejected at the boundary.
        if let SessionUpdate::ToolCall(call) = &notification.update {
            restore(&mut update, "title", Value::String(call.title.clone()));
            restore(&mut update, "kind", serde_json::to_value(call.kind)?);
            restore(&mut update, "status", serde_json::to_value(call.status)?);
        }

        self.append(
            ACP_UPDATE,
            json!({
                "notification": {
                    "sessionId": notification.session_id.to_string(),
                    "update": update,
                }
            }),
        )?;

        self.project(&notification.update)
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
                    self.store
                        .rename_tool_call(self.run_id, &tool_call_id, title)?
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

    fn persist_request(
        &mut self,
        request_id: &str,
        tool_call_id: &str,
        request: &RequestPermissionRequest,
    ) -> Result<()> {
        self.store
            .record_permission_request(self.run_id, request_id, Some(tool_call_id))?;

        let mut options = serde_json::to_value(&request.options)?;
        prune_nulls(&mut options);

        self.append(
            PERMISSION_REQUESTED,
            json!({
                "requestId": request_id,
                "toolCallId": tool_call_id,
                "title": self.permission_title(request, tool_call_id),
                "options": options,
            }),
        )
    }

    fn persist_resolution(&mut self, request_id: &str, decision: &Decision) -> Result<()> {
        // Refusing by choosing the agent's own refusal option is still a
        // selection as far as the protocol is concerned. Only an unanswered
        // request is cancelled.
        let (outcome, option_id, wire_outcome) = match decision {
            Decision::Allow(option_id) => (
                PermissionOutcome::Allowed,
                option_id.to_string(),
                "selected",
            ),
            Decision::Reject(option_id) => {
                (PermissionOutcome::Denied, option_id.to_string(), "selected")
            }
            Decision::Cancel => (PermissionOutcome::Cancelled, String::new(), "cancelled"),
        };

        let _settled = self.store.resolve_permission(request_id, outcome)?;

        self.append(
            PERMISSION_RESOLVED,
            json!({
                "requestId": request_id,
                "optionId": option_id,
                "outcome": wire_outcome,
            }),
        )
    }

    /// The interface requires a title; the protocol makes it optional.
    ///
    /// The request's own title wins, then the title already projected for that
    /// tool call, and only then the identifier as a last resort.
    fn permission_title(&self, request: &RequestPermissionRequest, tool_call_id: &str) -> String {
        if let Some(title) = request.tool_call.fields.title.clone() {
            return title;
        }

        self.store
            .tool_calls_for_run(self.run_id)
            .ok()
            .and_then(|calls| {
                calls
                    .into_iter()
                    .find(|call| call.id == tool_call_id)
                    .map(|call| call.title)
            })
            .unwrap_or_else(|| tool_call_id.to_owned())
    }

    fn finish(&mut self, status: RunStatus, kind: &str, body: Value, detail: &str) -> Result<()> {
        self.store.finish_run(self.run_id, status, Some(detail))?;

        // A failure always carries the agent account of it. A turn that ended
        // on the agent terms carries it only when the protocol carried
        // nothing, so a healthy turn is not narrated by its own logging.
        let mut body = body;
        let telling = kind == RUN_FAILED || self.updates == 0;

        if telling
            && !self.diagnostics.is_empty()
            && let Value::Object(fields) = &mut body
        {
            let _absent = fields.insert(
                "diagnostics".to_owned(),
                Value::String(self.diagnostics.clone()),
            );
        }

        self.append(kind, body)
    }

    fn append(&mut self, kind: &str, body: Value) -> Result<()> {
        let seq = self.next_seq;
        let mut frame = body;

        if let Value::Object(fields) = &mut frame {
            fields.insert("kind".to_owned(), Value::String(kind.to_owned()));
            fields.insert("seq".to_owned(), Value::from(seq));
            fields.insert("at".to_owned(), Value::from(now_millis()));
        }

        self.store.append_event(self.run_id, seq, kind, &frame)?;
        self.next_seq = seq.saturating_add(1);

        let event = RecordedEvent {
            run_id: self.run_id.to_string(),
            seq,
            kind: kind.to_owned(),
            frame,
        };

        (self.sink)(&event);

        Ok(())
    }

    fn remember(&mut self, outcome: Result<()>) {
        if let Err(error) = outcome
            && self.failure.is_none()
        {
            self.failure = Some(error);
        }
    }
}

/// Puts back a required field the serialiser left out.
///
/// `title`, `kind` and `status` are mandatory on a tool call announcement at
/// the interface boundary, while the protocol gives two of them defaults and
/// omits them on the wire when they hold that default. The value written here
/// is the SDK's own, through the same serialiser, so this restores a field
/// rather than inventing one, and a field the serialiser did emit is left
/// exactly as it was.
fn restore(update: &mut Value, field: &str, value: Value) {
    if let Value::Object(fields) = update
        && !fields.contains_key(field)
    {
        let _absent = fields.insert(field.to_owned(), value);
    }
}

/// Removes null members so that an optional field reads as absent.
fn prune_nulls(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            fields.retain(|_name, member| !member.is_null());
            for member in fields.values_mut() {
                prune_nulls(member);
            }
        }
        Value::Array(members) => {
            for member in members.iter_mut() {
                prune_nulls(member);
            }
        }
        _ => {}
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or_default()
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
