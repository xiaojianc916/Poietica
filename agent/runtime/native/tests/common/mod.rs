#![allow(
    dead_code,
    reason = "每个测试 crate 只用到日志的一部分，用不到的那部分不是死代码"
)]
#![allow(
    clippy::expect_used,
    reason = "a test proves itself by panicking, so a failed step must fail the test"
)]
//! 一份只会记住的日志。
//!
//! `RunLog` 定义了 recorder 对存储的全部要求，而这一层刻意不知道 SQLite、锁和
//! 文件的存在 —— 那个 trait 的模块头就是这么写的。所以这些测试也不该知道：它们
//! 问的是 recorder 做了什么，不是数据库存下了什么。
//!
//! 此前它们直接建一个真的 SQLCipher 库，还 use 了一个不在 dev-dependencies 里
//! 的 crate，于是从写下那天起就编译不过 —— 没人发现，因为 --all-targets 一直
//! 被更早的错误挡在外面。

use std::sync::{Arc, Mutex, MutexGuard};

use poietica_agent_runtime_native::{
    LogError, LogResult, OutstandingPermission, PermissionAnswer, RecordedToolCall, RunLog,
    RunOutcome, ToolCallState,
};
use serde_json::Value;
use uuid::Uuid;

/// 一帧写进去的东西。
#[derive(Clone, Debug)]
pub(crate) struct Appended {
    /// 它在这一轮里的位置。
    pub(crate) seq: i64,
    /// 日志种类。
    pub(crate) kind: String,
    /// 帧本身，和广播出去的那一份应当逐字段相同。
    pub(crate) frame: Value,
}

/// 一次工具调用，在投影里的样子。
#[derive(Clone, Debug)]
pub(crate) struct Projected {
    /// agent 用的标识符。
    pub(crate) id: String,
    /// 它被宣告或改名成的标题。
    pub(crate) title: String,
    /// 它的种类。
    pub(crate) kind: String,
    /// 它走到哪一步了。
    pub(crate) state: ToolCallState,
}

/// 一次许可请求，在投影里的样子。
#[derive(Clone, Debug)]
pub(crate) struct Asked {
    /// 这次请求的标识符。
    pub(crate) request_id: String,
    /// 它属于哪次工具调用。
    pub(crate) tool_call_id: Option<String>,
    /// 它被什么答案settle了，还没答就是 None。
    pub(crate) answer: Option<PermissionAnswer>,
}

/// 这份日志到目前为止收到的一切。
#[derive(Debug, Default)]
struct Written {
    frames: Vec<Appended>,
    calls: Vec<Projected>,
    permissions: Vec<Asked>,
    outcome: Option<RunOutcome>,
    refuse: Option<String>,
}

/// 内存里的日志。克隆出来的句柄指向同一份内容。
#[derive(Clone, Debug, Default)]
pub(crate) struct MemoryLog {
    written: Arc<Mutex<Written>>,
}

impl MemoryLog {
    /// 一份空日志。
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// 同一份日志的另一个句柄。
    ///
    /// recorder 拿走的是 `Box<dyn RunLog>`，所以读回它记下了什么需要另一个
    /// 句柄 —— 而"共享一份日志"本来就是这个 trait 留给实现者的自由。
    pub(crate) fn reader(&self) -> Self {
        self.clone()
    }

    /// 让接下来的每一次写都失败。
    pub(crate) fn refuse(&self, message: &str) {
        self.written().refuse = Some(message.to_owned());
    }

    /// 写进去的所有帧。
    pub(crate) fn frames(&self) -> Vec<Appended> {
        self.written().frames.clone()
    }

    /// 投影里的所有工具调用。
    pub(crate) fn calls(&self) -> Vec<Projected> {
        self.written().calls.clone()
    }

    /// 记下的所有许可请求，答过的和没答过的。
    pub(crate) fn permissions(&self) -> Vec<Asked> {
        self.written().permissions.clone()
    }

    /// 还等着答案的那些。
    pub(crate) fn outstanding(&self) -> Vec<Asked> {
        self.written()
            .permissions
            .iter()
            .filter(|asked| asked.answer.is_none())
            .cloned()
            .collect()
    }

    /// 这一轮被记成怎么结束的。
    pub(crate) fn outcome(&self) -> Option<RunOutcome> {
        self.written().outcome
    }

    fn written(&self) -> MutexGuard<'_, Written> {
        self.written.lock().expect("the log")
    }
}

impl RunLog for MemoryLog {
    fn append_event(&self, _run_id: Uuid, seq: i64, kind: &str, frame: &Value) -> LogResult<()> {
        let mut written = self.written();

        if let Some(message) = written.refuse.clone() {
            return Err(LogError::new(message));
        }

        written.frames.push(Appended {
            seq,
            kind: kind.to_owned(),
            frame: frame.clone(),
        });

        Ok(())
    }

    fn finish_run(
        &self,
        _run_id: Uuid,
        outcome: RunOutcome,
        _detail: Option<&str>,
    ) -> LogResult<()> {
        self.written().outcome = Some(outcome);

        Ok(())
    }

    fn apply_tool_call(
        &self,
        _run_id: Uuid,
        tool_call_id: &str,
        title: &str,
        kind: &str,
        state: ToolCallState,
    ) -> LogResult<()> {
        let mut written = self.written();

        // 同一个 id 被宣告两次是同一行，不是两行 —— 这正是那条"一次宣告加一次
        // 更新是一行"的断言要看的东西。
        if let Some(existing) = written
            .calls
            .iter_mut()
            .find(|call| call.id == tool_call_id)
        {
            existing.title = title.to_owned();
            existing.kind = kind.to_owned();
            existing.state = state;

            return Ok(());
        }

        written.calls.push(Projected {
            id: tool_call_id.to_owned(),
            title: title.to_owned(),
            kind: kind.to_owned(),
            state,
        });

        Ok(())
    }

    fn update_tool_call(
        &self,
        _run_id: Uuid,
        tool_call_id: &str,
        state: ToolCallState,
        title: Option<&str>,
    ) -> LogResult<bool> {
        let mut written = self.written();

        let Some(call) = written
            .calls
            .iter_mut()
            .find(|call| call.id == tool_call_id)
        else {
            return Ok(false);
        };

        call.state = state;

        if let Some(title) = title {
            call.title = title.to_owned();
        }

        Ok(true)
    }

    fn rename_tool_call(&self, _run_id: Uuid, tool_call_id: &str, title: &str) -> LogResult<bool> {
        let mut written = self.written();

        let Some(call) = written
            .calls
            .iter_mut()
            .find(|call| call.id == tool_call_id)
        else {
            return Ok(false);
        };

        call.title = title.to_owned();

        Ok(true)
    }

    fn record_permission_request(
        &self,
        _run_id: Uuid,
        request_id: &str,
        tool_call_id: Option<&str>,
    ) -> LogResult<()> {
        self.written().permissions.push(Asked {
            request_id: request_id.to_owned(),
            tool_call_id: tool_call_id.map(str::to_owned),
            answer: None,
        });

        Ok(())
    }

    fn resolve_permission(&self, request_id: &str, answer: PermissionAnswer) -> LogResult<bool> {
        let mut written = self.written();

        let Some(asked) = written
            .permissions
            .iter_mut()
            .find(|asked| asked.request_id == request_id)
        else {
            return Ok(false);
        };

        // 答过的请求不能再答一次：调用方靠这个返回值判断它还在不在等。
        if asked.answer.is_some() {
            return Ok(false);
        }

        asked.answer = Some(answer);

        Ok(true)
    }

    fn outstanding_permissions(&self, _run_id: Uuid) -> LogResult<Vec<OutstandingPermission>> {
        Ok(self
            .written()
            .permissions
            .iter()
            .filter(|asked| asked.answer.is_none())
            .map(|asked| OutstandingPermission {
                request_id: asked.request_id.clone(),
            })
            .collect())
    }

    fn tool_calls(&self, _run_id: Uuid) -> LogResult<Vec<RecordedToolCall>> {
        Ok(self
            .written()
            .calls
            .iter()
            .map(|call| RecordedToolCall {
                id: call.id.clone(),
                title: call.title.clone(),
            })
            .collect())
    }
}
