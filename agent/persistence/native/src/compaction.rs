//! 终态轮次的压缩投影。
//!
//! `run_events` 仍然是唯一的事实来源，这里不改写它的任何一行。快照是第三个
//! 投影，和 `tool_calls`、`permissions` 同一个身份：整张表随时可以删掉重建，
//! 删了只是变慢，不会丢任何东西。
//!
//! 压缩只做协议层的一件事：把相邻的、同一种、纯文本的流式片段合并成一帧。
//! 一次回答是几百到几千个片段，每个片段拖着一份 36 字节的会话号和整套包封，
//! 正文往往只有三五个字，而这些包封在界面那一侧 reduce 完之后一个字节都不
//! 剩。合并之后包封只留一份，重放的结果逐字段不变。
//!
//! 什么时候必须断开，是这个模块唯一需要小心的地方，见 fold 上的说明。

use serde_json::Value;

use crate::error::Result;
use crate::events::StoredEvent;
use crate::store::{AgentStore, now};

/// 快照的格式版本。
///
/// 折叠规则一旦改动就把它加一：旧版本的行不会被读到，会被重新建过。这就是
/// "投影可以重建"这句话的兑现方式，它替代的正是一次数据迁移。
pub(crate) const SNAPSHOT_VERSION: i64 = 1;

/// 可以合并的两种流式片段。
#[derive(Clone, Copy, Eq, PartialEq)]
enum Chunk {
    Message,
    Thought,
}

/// 这一帧是不是一个可以合并的纯文本片段。
///
/// 判据全部落在协议上，不碰产品语义：原生侧不知道什么叫"一条消息"，它只
/// 知道 sessionUpdate 是哪一种、content 是不是文本。
fn chunk_of(payload: &Value) -> Option<Chunk> {
    let update = payload.get("notification")?.get("update")?;

    let chunk = match update.get("sessionUpdate")?.as_str()? {
        "agent_message_chunk" => Chunk::Message,
        "agent_thought_chunk" => Chunk::Thought,
        _other => return None,
    };

    let content = update.get("content")?;

    // 非文本内容不合并。界面那侧的 textOf 对它返回空串，理论上并进去也等
    // 价，但那要依赖另一个模块的实现细节永不改变，这点收益不值。
    if content.get("type")?.as_str()? != "text" {
        return None;
    }

    content.get("text")?.as_str()?;

    Some(chunk)
}

/// 把后一帧的文字接到前一帧上。
fn absorb(into: &mut Value, from: &Value) -> bool {
    let Some(addition) = from
        .pointer("/notification/update/content/text")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return false;
    };

    let Some(Value::String(existing)) = into.pointer_mut("/notification/update/content/text")
    else {
        return false;
    };

    existing.push_str(&addition);

    true
}

/// 折叠一轮的帧序列。
///
/// 四条断开规则，每一条都对着界面那侧的一个判据：
///
/// 相邻才合并 —— 一旦中间隔着任何一帧，push 会先 sealTail，结果就不同了。
/// 同类才合并 —— appendChunk 的判据是 tail.type === type，正文和思考链不并。
/// 纯文本才合并 —— 见 `chunk_of`。
/// 不跨轮次 —— 调用方一次只交一轮的帧。
///
/// 合并出来的那一帧带的是这一串里第一帧的 `seq` 与 `recorded_at`，因为
/// appendChunk 也正是用第一帧决定 id 与 at 的，后续片段只把文字接上去。
pub(crate) fn fold(events: Vec<StoredEvent>) -> Vec<StoredEvent> {
    let mut folded: Vec<StoredEvent> = Vec::with_capacity(events.len());

    for event in events {
        let Some(chunk) = chunk_of(&event.payload) else {
            folded.push(event);
            continue;
        };

        /*
         * 三个判据是一条合取，不是三层结构：末帧存在、它与这一帧同类、
         * 而且文字真的接上去了。此前它们被写成三层没有 else 的嵌套 if，
         * 于是 last() 先算一遍"能不能并"，last_mut() 再借一次去并 ——
         * 同一个末帧被问了两次。edition 2024 的 let-chain 让它回到一条。
         */
        if let Some(tail) = folded.last_mut()
            && chunk_of(&tail.payload) == Some(chunk)
            && absorb(&mut tail.payload, &event.payload)
        {
            continue;
        }

        folded.push(event);
    }

    folded
}

impl AgentStore {
    /// 为一轮建快照，覆盖它已有的那一份。
    ///
    /// # Errors
    ///
    /// Fails when the run cannot be read or the write is rejected.
    pub(crate) fn snapshot(&self, run_id: &str) -> Result<()> {
        let folded = fold(self.frames_after(run_id, 0)?);
        let encoded = serde_json::to_string(&folded)?;
        let built_at = now()?;

        let mut statement = self.connection.prepare_cached(
            "INSERT INTO run_snapshots (run_id, version, frames, built_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(run_id) DO UPDATE
                SET version  = excluded.version,
                    frames   = excluded.frames,
                    built_at = excluded.built_at",
        )?;

        statement.execute(rusqlite::params![
            run_id,
            SNAPSHOT_VERSION,
            encoded,
            built_at
        ])?;

        Ok(())
    }

    /// 补建存量轮次的快照，一次一批，返回这一批建了几轮。
    ///
    /// 不需要游标：每一批的成果就是下一批的过滤条件，已经有快照的轮次不会
    /// 再被选中。调用方循环到它返回 0 为止。
    ///
    /// 最近的对话排在前面，因为最先被点开的就是它们。
    ///
    /// # Errors
    ///
    /// Fails when the log cannot be read or a snapshot cannot be written.
    pub fn compact_backlog(&self, limit: i64) -> Result<usize> {
        let pending: Vec<String> = {
            let mut statement = self.connection.prepare_cached(
                "SELECT runs.id
                   FROM runs
                   LEFT JOIN run_snapshots
                     ON run_snapshots.run_id = runs.id
                    AND run_snapshots.version = ?1
                  WHERE runs.status <> 'running'
                    AND run_snapshots.run_id IS NULL
                  ORDER BY runs.started_at DESC, runs.id DESC
                  LIMIT ?2",
            )?;

            let rows = statement
                .query_map(rusqlite::params![SNAPSHOT_VERSION, limit], |row| row.get(0))?;

            rows.collect::<rusqlite::Result<Vec<String>>>()?
        };

        for run_id in &pending {
            self.snapshot(run_id)?;
        }

        Ok(pending.len())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::fold;
    use crate::events::StoredEvent;

    fn chunk(seq: i64, sort: &str, text: &str) -> StoredEvent {
        StoredEvent {
            seq,
            kind: "acp_update".to_owned(),
            payload: json!({
                "kind": "acp_update",
                "seq": seq,
                "at": seq,
                "notification": {
                    "sessionId": "sess",
                    "update": {
                        "sessionUpdate": sort,
                        "content": { "type": "text", "text": text },
                    },
                },
            }),
            recorded_at: format!("2026-01-01T00:00:0{seq}Z"),
        }
    }

    fn plan(seq: i64) -> StoredEvent {
        StoredEvent {
            seq,
            kind: "acp_update".to_owned(),
            payload: json!({
                "kind": "acp_update",
                "seq": seq,
                "at": seq,
                "notification": {
                    "sessionId": "sess",
                    "update": { "sessionUpdate": "plan", "entries": [] },
                },
            }),
            recorded_at: format!("2026-01-01T00:00:0{seq}Z"),
        }
    }

    fn said(event: &StoredEvent) -> &str {
        event
            .payload
            .pointer("/notification/update/content/text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
    }

    #[test]
    fn joins_adjacent_text_of_one_sort() {
        let folded = fold(vec![
            chunk(1, "agent_message_chunk", "好的，"),
            chunk(2, "agent_message_chunk", "我来"),
            chunk(3, "agent_message_chunk", "看看"),
        ]);

        assert_eq!(folded.len(), 1);
        assert_eq!(said(&folded[0]), "好的，我来看看");
    }

    #[test]
    fn keeps_the_position_of_the_first_fragment() {
        let folded = fold(vec![
            chunk(7, "agent_message_chunk", "一"),
            chunk(8, "agent_message_chunk", "二"),
        ]);

        // 界面用第一帧决定 id 与 at，所以这两个字段必须是第一帧的。
        assert_eq!(folded[0].seq, 7);
        assert_eq!(folded[0].recorded_at, "2026-01-01T00:00:07Z");
    }

    #[test]
    fn stops_between_two_sorts() {
        let folded = fold(vec![
            chunk(1, "agent_thought_chunk", "想"),
            chunk(2, "agent_message_chunk", "说"),
        ]);

        assert_eq!(folded.len(), 2);
    }

    #[test]
    fn stops_at_anything_in_between() {
        let folded = fold(vec![
            chunk(1, "agent_message_chunk", "前"),
            plan(2),
            chunk(3, "agent_message_chunk", "后"),
        ]);

        assert_eq!(folded.len(), 3);
    }

    #[test]
    fn leaves_everything_else_alone() {
        let image = StoredEvent {
            seq: 2,
            kind: "acp_update".to_owned(),
            payload: json!({
                "notification": {
                    "sessionId": "sess",
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": { "type": "image", "data": "..." },
                    },
                },
            }),
            recorded_at: "2026-01-01T00:00:02Z".to_owned(),
        };

        let folded = fold(vec![chunk(1, "agent_message_chunk", "字"), image]);

        assert_eq!(folded.len(), 2);
    }
}
