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
use crate::frame::{RunFrame, acp_update, prune, wire_name};
use crate::permission::Decision;
use crate::run_log::{PermissionAnswer, RunLog, RunOutcome, ToolCallState};

/// The stop reason for a turn the user stopped, as the interface spells it.
const CANCELLED: &str = "cancelled";

/// 一个 `ToolKind` 连序列化器都说不出名字时的归类。协议自己留了这一档。
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

/// 一次运行的帧流：成形，然后投递。
///
/// 它不认识日志。此前这三个字段长在 [`Recorder`] 上，而 [`Recorder::append`]
/// 把「算序号」「写日志」「推给界面」焊成一个函数 —— 于是「只上屏、不落库」
/// 在类型上说不出来，而那正是装载一条旧会话时重播帧的处境：`session/load`
/// 期间 agent 把整条会话重放一遍，那些帧走的是同一个通知入口，此刻槽里没有
/// 记录器，它们被静默丢掉（见 driver.rs 的 `load_session`）。历史因此只能从
/// 本地日志再读一遍 —— 第二份真相就是这么来的。
///
/// 分成两步而不是一个 `emit`，是为了让序号的语义原样保留：位置在成形时只是
/// 被算出来，投递成功才算用掉。写日志失败时这一帧不投递，序号也就不前进，
/// 下一帧仍然占这个位置 —— 日志里不留空洞。
pub struct Frames {
    run_id: Uuid,
    next_seq: i64,
    sink: Box<dyn FnMut(&RecordedEvent) + Send>,
}

/// 一个闭包印不出来，但它长在一个公共结构上。
impl fmt::Debug for Frames {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Frames")
            .field("run_id", &self.run_id)
            .field("next_seq", &self.next_seq)
            .finish_non_exhaustive()
    }
}

impl Frames {
    /// 开始一条帧流，每一帧投递给 `sink`。
    #[must_use]
    pub fn new(run_id: Uuid, sink: Box<dyn FnMut(&RecordedEvent) + Send>) -> Self {
        Self {
            run_id,
            next_seq: 1,
            sink,
        }
    }

    /// 这条帧流属于哪一轮。
    #[must_use]
    pub const fn run_id(&self) -> Uuid {
        self.run_id
    }

    /// 给这一帧一个位置和一个时刻。位置此刻还没有被用掉。
    ///
    /// # Errors
    ///
    /// 序列化失败时报错；此时这一帧既不落盘也不投递。
    pub fn shape(&self, frame: &RunFrame) -> serde_json::Result<RecordedEvent> {
        let seq = self.next_seq;
        let kind = frame.kind();

        Ok(RecordedEvent {
            run_id: self.run_id.to_string(),
            seq,
            kind: kind.to_owned(),
            frame: frame.envelope(seq, now_millis())?,
        })
    }

    /// 交出去，位置就此用掉。
    pub fn deliver(&mut self, event: &RecordedEvent) {
        self.next_seq = event.seq.saturating_add(1);

        (self.sink)(event);
    }

    /// 装载一条旧会话时重播回来的一帧：成形，投递，不落库。
    ///
    /// 没有日志可写，因为这一份历史的持有者是 agent 而不是这台机器。走的是
    /// 与实时那一轮同一个 [`acp_update`]，所以两边的帧一模一样。
    ///
    /// # Errors
    ///
    /// 序列化失败时报错；此时这一帧不投递，位置也不前进。
    pub fn record_session_update(&mut self, notification: &SessionNotification) -> Result<()> {
        let event = self.shape(&acp_update(notification)?)?;

        self.deliver(&event);

        Ok(())
    }
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
    /// 成形与投递。这一半不认识日志，所以它也走得通没有日志的那条路。
    frames: Frames,
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
            .field("frames", &self.frames)
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
            frames: Frames::new(run_id, sink),
            failure: None,
            diagnostics: String::new(),
            updates: 0,
        }
    }

    /// The run being recorded.
    #[must_use]
    pub const fn run_id(&self) -> Uuid {
        self.frames.run_id()
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
        let outcome = self.append(&RunFrame::RunStarted {
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

    /// The requests this run is still waiting on.
    ///
    /// 一轮结束时要从权限桌上放掉的就是这些。读不出来就当作没有：那件事
    /// 会由紧接着的 `record_pending_cancelled` 记成失败。
    pub fn outstanding_permissions(&mut self) -> Vec<String> {
        self.log
            .outstanding_permissions(self.frames.run_id())
            .map(|pending| {
                pending
                    .into_iter()
                    .map(|record| record.request_id)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Settles every request still outstanding when the turn ended.
    pub fn record_pending_cancelled(&mut self) {
        let pending = match self.log.outstanding_permissions(self.frames.run_id()) {
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

        self.append(&acp_update(notification)?)?;

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
                        self.frames.run_id(),
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
                        self.frames.run_id(),
                        &tool_call_id,
                        status,
                        change.fields.title.as_deref(),
                    )?
                } else if let Some(title) = change.fields.title.as_deref() {
                    self.log
                        .rename_tool_call(self.frames.run_id(), &tool_call_id, title)?
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
            .record_permission_request(self.frames.run_id(), request_id, Some(tool_call_id))?;

        let mut options = serde_json::to_value(&request.options)?;
        let mut tool_call = serde_json::to_value(&request.tool_call)?;

        prune(&mut options);
        prune(&mut tool_call);

        let title = self.permission_title(request, tool_call_id);

        self.append(&RunFrame::PermissionRequested {
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

        self.append(&RunFrame::PermissionResolved {
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
            .tool_calls(self.frames.run_id())
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
        self.log
            .finish_run(self.frames.run_id(), status, Some(detail))?;

        let frame = self.narrate(frame);

        self.append(&frame)
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

    /// 成形、落库、投递，按这个顺序。
    ///
    /// 顺序是一条保证：界面看得见的每一帧都已经耐久，所以它永远不会看到一帧
    /// 在重启之后消失。落库失败时这一帧不投递，序号也不前进。
    fn append(&mut self, frame: &RunFrame) -> Result<()> {
        let event = self.frames.shape(frame)?;

        self.log
            .append_event(self.frames.run_id(), event.seq, &event.kind, &event.frame)?;

        self.frames.deliver(&event);

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

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use uuid::Uuid;

    use super::{Frames, RecordedEvent};
    use crate::frame::RunFrame;

    fn ending() -> RunFrame {
        RunFrame::RunFinished {
            stop_reason: "end_turn".to_owned(),
            diagnostics: None,
        }
    }

    /// 落库失败的那一帧不该在日志里留下一个空号，所以成形不占位置。
    #[test]
    fn a_position_is_used_up_only_once_the_frame_is_delivered() {
        let seen: Arc<Mutex<Vec<i64>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);

        let mut frames = Frames::new(
            Uuid::nil(),
            Box::new(move |event: &RecordedEvent| {
                if let Ok(mut held) = sink.lock() {
                    held.push(event.seq);
                }
            }),
        );

        let shaped = frames.shape(&ending()).expect("the frame shapes");

        assert_eq!(shaped.seq, 1);
        assert_eq!(
            frames.shape(&ending()).expect("shaping again").seq,
            1,
            "成形两次仍是同一个位置：没有投递就没有用掉"
        );

        frames.deliver(&shaped);

        assert_eq!(
            frames.shape(&ending()).expect("after delivery").seq,
            2,
            "投递之后位置才前进"
        );
        assert_eq!(*seen.lock().expect("the sink is readable"), vec![1]);
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
