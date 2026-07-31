use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use agent_client_protocol::schema::v1::{
    RequestPermissionRequest, SessionNotification, SessionUpdate,
};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::error::{AcpError, Result};
use crate::frame::{RunFrame, acp_update, prune};
use crate::permission::Decision;

/// 一帧，已经成形，可以交出去了。
///
/// `frame` 就是界面读的那一份，也是装载一条旧会话时重播回来的那一份 —— 两者
/// 由同一个 `acp_update` 做出来，所以重开一条对话与看着它发生不可能对不上。
/// 会话号既在帧里也在这一层：帧是会话发生的事，投递也按同一个主语寻址。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedEvent {
    /// The session the frame belongs to.
    pub session_id: String,
    /// Position within the session, starting at one.
    pub seq: i64,
    /// Discriminator, as `RunFrame::kind` spells it.
    pub kind: String,
    /// The frame as the interface receives it.
    pub frame: Value,
}

/// 一帧交出去的地方。
///
/// 四处签名都要写这一串，而它们说的是同一件事。
pub type FrameSink = Box<dyn FnMut(&RecordedEvent) + Send>;

/// 一条会话上的序号线。
///
/// 位置按会话单调，不按轮次。此前它是 [`Frames`] 自己的一个 `i64`，每一轮新
/// 造一条流就从头数起 —— 同一条会话上的第二轮因此与第一轮撞号，而界面正是用
/// 「seq 单调」去重的。装载期重播的帧与实时帧同属一条会话，所以也从这一条线
/// 取号。
///
/// 它的家在会话槽（见 `run_slot.rs`）：听众换人，位置接着数。
#[derive(Clone, Debug)]
pub struct SeqLine(Arc<AtomicI64>);

impl Default for SeqLine {
    fn default() -> Self {
        Self(Arc::new(AtomicI64::new(1)))
    }
}

impl SeqLine {
    /// 一条从一开始的序号线。
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 下一帧会站的位置。此刻还没有被用掉。
    fn peek(&self) -> i64 {
        self.0.load(Ordering::Acquire)
    }

    /// 这个位置用掉了。
    fn used(&self, seq: i64) {
        self.0.store(seq.saturating_add(1), Ordering::Release);
    }
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
    session_id: String,
    seq: SeqLine,
    sink: FrameSink,
}

/// 一个闭包印不出来，但它长在一个公共结构上。
impl fmt::Debug for Frames {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Frames")
            .field("session_id", &self.session_id)
            .field("seq", &self.seq)
            .finish_non_exhaustive()
    }
}

impl Frames {
    /// 开始一条帧流：帧属于 `session_id`，位置从它那条序号线上取。
    #[must_use]
    pub fn new(session_id: String, seq: SeqLine, sink: FrameSink) -> Self {
        Self {
            session_id,
            seq,
            sink,
        }
    }

    /// 给这一帧一个位置和一个时刻。位置此刻还没有被用掉。
    ///
    /// # Errors
    ///
    /// 序列化失败时报错；此时这一帧既不落盘也不投递。
    pub fn shape(&self, frame: &RunFrame) -> serde_json::Result<RecordedEvent> {
        let seq = self.seq.peek();
        let kind = frame.kind();

        Ok(RecordedEvent {
            session_id: self.session_id.clone(),
            seq,
            kind: kind.to_owned(),
            frame: frame.envelope(&self.session_id, seq, now_millis())?,
        })
    }

    /// 交出去，位置就此用掉。
    pub fn deliver(&mut self, event: &RecordedEvent) {
        self.seq.used(event.seq);

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

/// 一轮的记录者：决定此刻发生了哪一种事，然后把它做成一帧交出去。
///
/// 它不写任何存储。一段对话的持有者是 agent，历史由 `session/load` 交回来
/// （见 commands/agent.rs 的 `agent_open_thread`），所以本地再记一份，记的
/// 就是第二份真相 —— 两份一旦分叉，屏幕上那份是对面那份的赝品。
///
/// 剩下的两张表是这一轮自己的工作内存：见过的工具调用叫什么，还有谁在等
/// 答复。一轮结束它们跟着走，本来就不该活到下一次启动。
///
/// 帧的形状不在这里定义。这里只决定「此刻发生了哪一种事」，形状由 frame.rs
/// 的 `RunFrame` 说了算，于是一个拼错的字段名过不了编译。
pub struct Recorder {
    /// 成形与投递。
    frames: Frames,
    failure: Option<AcpError>,
    /// What the agent said on its own error stream during this run.
    diagnostics: String,
    /// How many session updates this run carried.
    updates: u32,
    /// 这一轮见过的工具调用叫什么。
    ///
    /// 权限请求可以不带标题，界面却要求有一个。此前那个退路是去日志里查，
    /// 于是「这一轮正在发生什么」被存进了「历史」——两个身份压在一张表上。
    /// 它本来就是一轮的工作内存，一轮结束就该跟着走。
    titles: HashMap<String, String>,
    /// 还没有人答复的权限请求，按到达顺序。
    pending: Vec<String>,
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
    /// Starts recording a turn on one session, forwarding every frame to `sink`.
    #[must_use]
    pub fn new(session_id: String, seq: SeqLine, sink: FrameSink) -> Self {
        Self {
            frames: Frames::new(session_id, seq, sink),
            failure: None,
            diagnostics: String::new(),
            updates: 0,
            titles: HashMap::new(),
            pending: Vec::new(),
        }
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
    pub fn record_run_started(&mut self, prompt: &str) {
        let outcome = self.append(&RunFrame::RunStarted {
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
    /// 一轮结束时要从权限桌上放掉的就是这些。请求号是这个记录器自己发的，
    /// 答复也从它手上过，所以这份清单本来就在它这里。此前它绕道去问日志，
    /// 唯一的理由是日志恰好也存了一份。
    pub fn outstanding_permissions(&mut self) -> Vec<String> {
        self.pending.clone()
    }

    /// Settles every request still outstanding when the turn ended.
    pub fn record_pending_cancelled(&mut self) {
        // 先取走再逐个记：每一次记录都会把它自己从清单里划掉，边遍历边改
        // 同一个 Vec 是借用检查器本来就不允许的事。
        for request_id in std::mem::take(&mut self.pending) {
            self.record_permission_resolved(&request_id, &Decision::Cancel);
        }
    }

    /// Records that the run ended on the agent's terms.
    pub fn record_run_finished(&mut self, stop_reason: &str) {
        let outcome = self.finish(RunFrame::RunFinished {
            stop_reason: stop_reason.to_owned(),
            diagnostics: None,
        });
        self.remember(outcome);
    }

    /// Records that the run ended in a failure.
    pub fn record_run_failed(&mut self, message: &str) {
        let outcome = self.finish(RunFrame::RunFailed {
            message: message.to_owned(),
            diagnostics: None,
        });
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
                self.titles
                    .insert(call.tool_call_id.to_string(), call.title.clone());
            }
            SessionUpdate::ToolCallUpdate(change) => {
                let tool_call_id = change.tool_call_id.to_string();

                // 认不认得这次调用，就看这一轮宣告过它没有。此前这个答案由
                // 一次 UPDATE 影响了几行给出 —— 同一个问题，绕了一趟数据库。
                let Some(title) = self.titles.get_mut(&tool_call_id) else {
                    return Err(AcpError::UnknownToolCall { tool_call_id });
                };

                if let Some(renamed) = change.fields.title.clone() {
                    *title = renamed;
                }
            }
            // 协议还会长出新的更新种类。它们照样成帧交出去，只是这一轮的
            // 工作内存里没有它们的位置。
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
        self.pending.push(request_id.to_owned());

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
        let (option_id, outcome) = match decision {
            Decision::Allow(option_id) | Decision::Reject(option_id) => {
                (option_id.to_string(), "selected")
            }
            Decision::Cancel => (String::new(), "cancelled"),
        };

        self.pending.retain(|waiting| waiting != request_id);

        self.append(&RunFrame::PermissionResolved {
            request_id: request_id.to_owned(),
            option_id,
            outcome: outcome.to_owned(),
        })
    }

    /// The interface requires a title; the protocol makes it optional.
    ///
    /// 退而求其次的那个标题来自这一轮自己见过的工具调用。每一次 `ToolCall`
    /// 与每一次改名都从 `project` 过一遍，所以这里不必回头去查日志。
    fn permission_title(&self, request: &RequestPermissionRequest, tool_call_id: &str) -> String {
        if let Some(title) = request.tool_call.fields.title.clone() {
            return title;
        }

        self.titles
            .get(tool_call_id)
            .cloned()
            .unwrap_or_else(|| tool_call_id.to_owned())
    }

    fn finish(&mut self, frame: RunFrame) -> Result<()> {
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

    /// 成形，然后投递。
    ///
    /// 成形失败的那一帧不投递，序号也不前进：位置在投递成功时才算用掉，见
    /// [`Frames::shape`]。
    fn append(&mut self, frame: &RunFrame) -> Result<()> {
        let event = self.frames.shape(frame)?;

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

/// 现在，毫秒。
///
/// 时钟走在 1970 之前、或者走过 i64 毫秒能表示的尽头时算 0。两处兜底都是有意
/// 的：帧上的时刻是给人看的排序依据，让一次记录因为系统时钟不对劲而失败，换来
/// 的是一条对话在屏幕上断掉 —— 代价不对等。
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    // 与 tests/recorder.rs 顶上那一句同一条纪律、同一个理由。根 Cargo.toml 说
    // 「#[cfg(test)] 模块内层统一放开」，但仓库根没有 clippy.toml，也就没有
    // allow-expect-in-tests —— 放开一直是逐处写出来的，这个内联模块只是漏了。
    #![allow(
        clippy::expect_used,
        reason = "a test proves itself by panicking, so a failed step must fail the test"
    )]

    use std::sync::{Arc, Mutex};

    use super::{Frames, RecordedEvent, SeqLine};
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
            "sess_alpha".to_owned(),
            SeqLine::new(),
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
