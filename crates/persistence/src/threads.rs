//! Conversations: their names, their sessions, and their place in the list.

use rusqlite::types::{FromSql, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::Result;
use crate::store::{AgentStore, now};

impl AgentStore {
    /// 一条写语句，走和读一样的那个语句缓存。
    ///
    ///  `读那两条（list_threads、thread）一直用`  `prepare_cached，写这六条用的是 `
    ///  `Connection::execute ` —— 它内部每次都重新 prepare，也就是把同一段 SQL
    /// 重新 parse 一遍、重新 plan 一遍。同一个文件里两套约定，不是取舍，是漏了。
    ///
    /// 省下的是微秒：这六条都由人的动作触发，不在任何热路径上。真正的收益是
    /// 只剩一条写路径 —— 下一个人照着抄的时候，抄到的是对的那一种。
    fn write(&self, sql: &str, params: &[&dyn ToSql]) -> Result<()> {
        self.connection.prepare_cached(sql)?.execute(params)?;

        Ok(())
    }

    /// Creates a thread and returns its identifier.
    ///
    /// # Errors
    ///
    /// Fails when the insert is rejected.
    pub fn create_thread(&self, title: &str) -> Result<Uuid> {
        let id = Uuid::now_v7();
        let timestamp = now()?;

        self.write(
            "INSERT INTO threads (id, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            rusqlite::params![id.to_string(), title, timestamp],
        )?;

        Ok(id)
    }

    /// Lists every thread, most recently touched first.
    ///
    /// # Errors
    ///
    /// Fails when the query is rejected.
    // 没被说过话的对话不进列表。判据此前是「有没有 runs 行」，而本地已经
    // 不再记轮次。同一件事现在由名字回答：一条对话的名字取自它的第一句话
    // （record_prompt），所以还挂着占位名的，就是还没有人开口的那一条。
    // 迁移 0009 在删表之前把存量对齐过，列表成员一行不差。
    pub fn list_threads(&self) -> Result<Vec<ThreadSummary>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT id, session_id, agent_id, title, title_source, updated_at, pinned
               FROM threads
              WHERE title_source <> 'fallback'
              ORDER BY pinned DESC, updated_at DESC",
        )?;

        let found = statement
            .query_map([], |row| {
                Ok(ThreadSummary {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    agent_id: row.get(2)?,
                    title: row.get(3)?,
                    title_source: row.get(4)?,
                    updated_at: row.get(5)?,
                    pinned: row.get::<_, i64>(6)? != 0,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(found)
    }

    /// Records which agent session a thread is holding, and whose it is.
    ///
    /// 两件事一起写，因为分开写就有一瞬间是号在而人不在，而那正是这一列要
    /// 消灭的状态。
    ///
    /// `updated_at` is left alone. Reopening a conversation from a previous
    /// run makes it take a fresh session, and a conversation last spoken in
    /// a week ago is still a week old after being looked at. Touching the
    /// column here sent whatever was opened to the top of the list, which
    /// is the opposite of what opening it was for.
    pub fn attach_session(&self, id: Uuid, session_id: &str, agent_id: &str) -> Result<()> {
        self.write(
            "UPDATE threads
                SET session_id = ?2, agent_id = ?3
              WHERE id = ?1",
            rusqlite::params![id.to_string(), session_id, agent_id],
        )?;

        Ok(())
    }

    /// Reads one conversation, whether or not anything has been said in it.
    ///
    /// [`Self::list_threads`] leaves out a conversation with no runs,
    /// because a list of conversations is a list of the ones that happened.
    /// Reading back the conversation that was just created is a different
    /// question, and asking the list it is deliberately absent from was how
    /// opening one came to fail every single time.
    ///
    /// # Errors
    ///
    /// Fails when the query is rejected.
    pub fn thread(&self, id: Uuid) -> Result<Option<ThreadSummary>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT id, session_id, agent_id, title, title_source, updated_at, pinned
               FROM threads
              WHERE id = ?1",
        )?;

        let mut rows = statement.query(rusqlite::params![id.to_string()])?;

        match rows.next()? {
            Some(row) => Ok(Some(ThreadSummary {
                id: row.get(0)?,
                session_id: row.get(1)?,
                agent_id: row.get(2)?,
                title: row.get(3)?,
                title_source: row.get(4)?,
                updated_at: row.get(5)?,
                pinned: row.get::<_, i64>(6)? != 0,
            })),
            None => Ok(None),
        }
    }

    /// 记下这条对话刚被说了一句话。
    ///
    /// 一句话是两个事实，而它们的频率不同：这条对话**刚刚有活动**，每一轮都
    /// 成立；这条对话**叫什么**，只由第一句话回答一次。
    ///
    /// 此前它们共用一条 `WHERE title_source = 'fallback'`：那个条件是为第二个
    /// 事实准备的，却把第一个也一并守掉了。于是在一条旧对话里继续说话，整条
    /// 语句被拒，`updated_at` 一动不动 —— 而列表正是按它排序（见 `list_threads`
    /// 的 `ORDER BY`）。屏幕上的表现是：刚说过话的对话不会浮上来，永远停在它
    /// 第一句话的时间上。
    ///
    /// 两个事实因此写进同一条语句、各带各的条件：时间无条件更新，名字只在还
    /// 没有名字的时候写。一次往返，一条写路径，没有第二处需要保持同步。
    ///
    /// 命名仍然只发生一次：后一轮的开场白改不动一条已经有名字的对话，用户手
    /// 打的名字（`manual`）更不会被它顶掉。`list_threads` 用「标题源还是
    /// fallback」判断有没有人开过口，这条语句让那个判据继续成立。
    pub fn record_prompt(&self, id: Uuid, title: &str) -> Result<()> {
        let timestamp = now()?;

        self.write(
            "UPDATE threads
                SET title        = CASE WHEN title_source = ?4 THEN ?2 ELSE title END,
                    title_source = CASE WHEN title_source = ?4 THEN ?5 ELSE title_source END,
                    updated_at   = ?3
              WHERE id = ?1",
            rusqlite::params![
                id.to_string(),
                title,
                timestamp,
                TitleSource::Fallback,
                TitleSource::Message,
            ],
        )?;

        Ok(())
    }

    /// Names a conversation on the user's say-so.
    ///
    /// Recorded as its own source because it outranks the opening message it
    /// replaces: someone has answered this question by hand, so nothing
    /// derived from the text gets to answer it again.
    pub fn name_by_user(&self, id: Uuid, title: &str) -> Result<()> {
        self.write(
            "UPDATE threads
                SET title = ?2, title_source = ?3
              WHERE id = ?1",
            rusqlite::params![id.to_string(), title, TitleSource::Manual],
        )?;

        Ok(())
    }

    /// Holds a conversation at the top of the list, or releases it.
    ///
    /// Pinning is not activity, so the timestamp is left alone: a
    /// conversation pinned today does not become today's conversation.
    pub fn set_pinned(&self, id: Uuid, pinned: bool) -> Result<()> {
        self.write(
            "UPDATE threads SET pinned = ?2 WHERE id = ?1",
            rusqlite::params![id.to_string(), i64::from(pinned)],
        )?;

        Ok(())
    }

    /// Deletes a conversation from the local index.
    ///
    /// 一行没了就是没了：这张表底下已经不挂任何东西。对话在 agent 那边的
    /// 那一份由 session/delete 去删，两边各删各的一份，这里不越权。
    ///
    /// # Errors
    ///
    /// Fails when the delete is rejected.
    pub fn delete_thread(&self, id: Uuid) -> Result<()> {
        self.write(
            "DELETE FROM threads WHERE id = ?1",
            rusqlite::params![id.to_string()],
        )?;

        Ok(())
    }
}

/// One conversation, as a list of conversations needs it.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ThreadSummary {
    /// The thread identifier, as text.
    pub id: String,
    /// The agent session it is holding, where it holds one.
    pub session_id: Option<String>,
    /// 开出那个会话的 agent。这一列存在之前写下的行是空的。
    pub agent_id: Option<String>,
    /// The name currently shown for it.
    pub title: String,
    /// Where that name came from.
    pub title_source: TitleSource,
    /// When it was last touched, in RFC 3339.
    pub updated_at: String,
    /// Whether it is held at the top of the list.
    pub pinned: bool,
}

/// Where a thread name came from, in the order they outrank each other.
///
/// Naming a conversation is this program's job. There was a fourth source
/// above all of these, taken from the agent's own session list, on the
/// reasoning that the agent is the authority on what its session is called.
/// It is the authority on that, and that is a different question: the name
/// is whatever the agent wrote in its own store when the session was
/// created, and an agent under no obligation to ever revise it will not.
/// Ranking it above what the user actually typed is how a list of
/// conversations became a column of the words New Session.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TitleSource {
    /// Taken from the first thing the user said, which is what a
    /// conversation in a list should read as.
    Message,
    /// Shown before there was anything to take a name from.
    Fallback,
    /// The user typed it. Nothing derived replaces it.
    Manual,
}

impl TitleSource {
    /// The text this source is stored as.
    ///
    /// One table, not two. serde's `rename_all` encodes the same three
    /// spellings for the wire and the two happened to agree; two encodings of
    /// one closed set is how they stop agreeing.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Message => "message",
            Self::Fallback => "fallback",
            Self::Manual => "manual",
        }
    }
}

impl ToSql for TitleSource {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for TitleSource {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "message" => Ok(Self::Message),
            "manual" => Ok(Self::Manual),
            // Anything else is a row an older build wrote, and the only value
            // that ever was is the deleted fourth source. It outranked the
            // name the user typed; read back at the lowest rank the stored
            // title still shows and no longer outranks anything. Refusing the
            // row instead would take the whole sidebar down over one value.
            _ => Ok(Self::Fallback),
        }
    }
}
