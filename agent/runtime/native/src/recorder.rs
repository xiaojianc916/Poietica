use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

use agent_client_protocol::schema::v1::{
    RequestPermissionRequest, SessionNotification, SessionUpdate,
    ToolCallStatus as ProtocolToolCallStatus,
};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::error::{AcpError, Result};
use crate::frame::{FrameNotification, RunFrame, normalize, prune, wire_name};
use crate::permission::Decision;
use crate::run_log::{PermissionAnswer, RunLog, RunOutcome, ToolCallState};

/// The stop reason for a turn the user stopped, as the interface spells it.
const CANCELLED: &str = "cancelled";

/// 一个 ToolKind 连序列化器都说不出名字时的归类。协议自己留了这一档。
const OTHER: &str = "other";

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
    /// Discriminator, as `RunFrame::kind` spells it.
    pub kind: String,
    /// The frame as the interface receives it.
    pub frame: Value,
}

/// Writes the event log and keeps the projections in step with it.
///
/// The order inside every method is deliberate: append to the log, update the
/// projections, then forward. A consumer can therefore never observe an event
/// that would disappear on restart.
///
/// 帧的形状不在这里定义。这里只决定「此刻发生了哪一种事」，形状由 frame.rs
/// 的 `RunFrame` 说了算，于是一个拼错的字段名过不了编译。
pub struct Recorder {
    /// Where frames are made durable.
    log: Box<dyn RunLog>,
    run_id: Uuid,
    next_seq: i64,
    sink: Box<dyn FnMut(&RecordedEvent) + Send>,
    failure: Option<AcpError>,
    /// What the agent said on its own error stream during this run.
    diagnostics: String,
    /// How many session updates this run carried.
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
    pub fn new(
        log: Box<dyn RunLog>,
        run_id: Uuid,
        sink: Box<dyn FnMut(&RecordedEvent) + Send>,
    ) -> Self {
        Self {
            log,
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

    /// Hands over what the agent said on its own error stream.
    pub fn set_diagnostics(&mut self, text: String) {
        self.diagnostics = text;
    }

    /// Takes the first failure observed while recording, if there was one.
    pub fn take_failure(&mut self) -> Option<AcpError> {
        self.failure.take()
    }

    /// Records that the run began, and what was asked.
    pub fn record_run_started(&mut self, session_id: &str, prompt: &str) {
        let outcome = self.append(RunFrame::RunStarted {
            session_id: session_id.to_owned(),
            prompt: prompt.to_owned(),
        });
        self.remember(outcome);
    }

    /// Records a session notification and projects it.
    pub fn record_session_update(&mut self, notification: &SessionNotification) {
        let outcome = self.persist_update(notification);
        self.remember(outcome);
    }

    /// Records a permission request the agent is now blocked on.
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
    pub fn record_pending_cancelled(&mut self) {
        let pending = match self.log.outstanding_permissions(self.run_id) {
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
            RunOutcome::Finished,
            RunFrame::RunFinished {
                stop_reason: stop_reason.to_owned(),
                diagnostics: None,
            },
            stop_reason,
        );
        self.remember(outcome);
    }

    /// Records that the user stopped the run.
    ///
    /// The frame is a normal end of turn carrying the protocol's own cancelled
    /// stop reason. The run row is marked cancelled rather than finished,
    /// because that is what happened.
    pub fn record_run_cancelled(&mut self) {
        let outcome = self.finish(
            RunOutcome::Cancelled,
            RunFrame::RunFinished {
                stop_reason: CANCELLED.to_owned(),
                diagnostics: None,
            },
            CANCELLED,
        );
        self.remember(outcome);
    }

    /// Records that the run ended in a failure.
    pub fn record_run_failed(&mut self, message: &str) {
        let outcome = self.finish(
            RunOutcome::Failed,
            RunFrame::RunFailed {
                message: message.to_owned(),
                diagnostics: None,
            },
            message,
        );
        self.remember(outcome);
    }

    fn persist_update(&mut self, notification: &SessionNotification) -> Result<()> {
        self.updates = self.updates.saturating_add(1);

        let mut update = serde_json::to_value(&notification.update)?;

        normalize(&mut update, &notification.update)?;

        self.append(RunFrame::AcpUpdate {
            notification: FrameNotification {
                session_id: notification.session_id.to_string(),
                update,
            },
        })?;

        self.project(&notification.update)
    }

    fn project(&mut self, update: &SessionUpdate) -> Result<()> {
        match update {
            SessionUpdate::ToolCall(call) => {
                // An unrecognised state is left out of the projection rather
                // than guessed at; the log still carries it verbatim.
                if let Some(status) = translate(call.status) {
                    let kind = wire_name(call.kind).unwrap_or_else(|| OTHER.to_owned());

                    self.log.apply_tool_call(
                        self.run_id,
                        &call.tool_call_id.to_string(),
                        &call.title,
                        &kind,
                        status,
                    )?;
                }
            }
            SessionUpdate::ToolCallUpdate(change) => {
                let tool_call_id = change.tool_call_id.to_string();

                let matched = if let Some(status) = change.fields.status.and_then(translate) {
                    self.log.update_tool_call(
                        self.run_id,
                        &tool_call_id,
                        status,
                        change.fields.title.as_deref(),
                    )?
                } else if let Some(title) = change.fields.title.as_deref() {
                    self.log
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
        self.log
            .record_permission_request(self.run_id, request_id, Some(tool_call_id))?;

        let mut options = serde_json::to_value(&request.options)?;
        let mut tool_call = serde_json::to_value(&request.tool_call)?;

        prune(&mut options);
        prune(&mut tool_call);

        let title = self.permission_title(request, tool_call_id);

        self.append(RunFrame::PermissionRequested {
            request_id: request_id.to_owned(),
            tool_call_id: tool_call_id.to_owned(),
            title,
            tool_call,
            options,
        })
    }

    fn persist_resolution(&mut self, request_id: &str, decision: &Decision) -> Result<()> {
        // Refusing by choosing the agent's own refusal option is still a
        // selection as far as the protocol is concerned. Only an unanswered
        // request is cancelled.
        let (outcome, option_id, wire_outcome) = match decision {
            Decision::Allow(option_id) => {
                (PermissionAnswer::Allowed, option_id.to_string(), "selected")
            }
            Decision::Reject(option_id) => {
                (PermissionAnswer::Denied, option_id.to_string(), "selected")
            }
            Decision::Cancel => (PermissionAnswer::Cancelled, String::new(), "cancelled"),
        };

        let _settled = self.log.resolve_permission(request_id, outcome)?;

        self.append(RunFrame::PermissionResolved {
            request_id: request_id.to_owned(),
            option_id,
            outcome: wire_outcome.to_owned(),
        })
    }

    /// The interface requires a title; the protocol makes it optional.
    fn permission_title(&self, request: &RequestPermissionRequest, tool_call_id: &str) -> String {
        if let Some(title) = request.tool_call.fields.title.clone() {
            return title;
        }

        self.log
            .tool_calls(self.run_id)
            .ok()
            .and_then(|calls| {
                calls
                    .into_iter()
                    .find(|call| call.id == tool_call_id)
                    .map(|call| call.title)
            })
            .unwrap_or_else(|| tool_call_id.to_owned())
    }

    fn finish(&mut self, status: RunOutcome, frame: RunFrame, detail: &str) -> Result<()> {
        self.log.finish_run(self.run_id, status, Some(detail))?;

        let frame = self.narrate(frame);

        self.append(frame)
    }

    /// A failure always carries the agent account of it. A turn that ended on
    /// the agent terms carries it only when the protocol carried nothing, so a
    /// healthy turn is not narrated by its own logging.
    fn narrate(&self, frame: RunFrame) -> RunFrame {
        if self.diagnostics.is_empty() {
            return frame;
        }

        let said = Some(self.diagnostics.clone());

        match frame {
            RunFrame::RunFailed { message, .. } => RunFrame::RunFailed {
                message,
                diagnostics: said,
            },
            RunFrame::RunFinished { stop_reason, .. } if self.updates == 0 => {
                RunFrame::RunFinished {
                    stop_reason,
                    diagnostics: said,
                }
            }
            other => other,
        }
    }

    fn append(&mut self, frame: RunFrame) -> Result<()> {
        let seq = self.next_seq;
        let kind = frame.kind();
        let body = frame.envelope(seq, now_millis())?;

        self.log.append_event(self.run_id, seq, kind, &body)?;
        self.next_seq = seq.saturating_add(1);

        let event = RecordedEvent {
            run_id: self.run_id.to_string(),
            seq,
            kind: kind.to_owned(),
            frame: body,
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

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or_default()
}

fn translate(status: ProtocolToolCallStatus) -> Option<ToolCallState> {
    match status {
        ProtocolToolCallStatus::Pending => Some(ToolCallState::Pending),
        ProtocolToolCallStatus::InProgress => Some(ToolCallState::InProgress),
        ProtocolToolCallStatus::Completed => Some(ToolCallState::Completed),
        ProtocolToolCallStatus::Failed => Some(ToolCallState::Failed),
        _ => None,
    }
}
