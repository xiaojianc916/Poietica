//! Conversations: their names, their sessions, and their place in the list.

use rusqlite::types::{FromSql, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::Result;
use crate::store::{AgentStore, now};

impl AgentStore {
    /// Creates a thread and returns its identifier.
    ///
    /// # Errors
    ///
    /// Fails when the insert is rejected.
    pub fn create_thread(&self, title: &str) -> Result<Uuid> {
        let id = Uuid::now_v7();
        let timestamp = now()?;

        self.connection.execute(
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
    // （name_from_message），所以还挂着占位名的，就是还没有人开口的那一条。
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
    ///
    /// # Errors
    ///
    /// Fails when the update is rejected.
    pub fn attach_session(&self, id: Uuid, session_id: &str, agent_id: &str) -> Result<()> {
        self.connection.execute(
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

    /// Names a conversation after the first thing said in it.
    ///
    /// This is where a conversation normally gets its name. Only a
    /// conversation that has none yet is named: the statement refuses the
    /// update otherwise, so the opening line of a later turn cannot displace
    /// the name the conversation is already known by.
    ///
    /// # Errors
    ///
    /// Fails when the update is rejected.
    pub fn name_from_message(&self, id: Uuid, title: &str) -> Result<()> {
        let timestamp = now()?;

        self.connection.execute(
            "UPDATE threads
                SET title = ?2, title_source = ?3, updated_at = ?4
              WHERE id = ?1 AND title_source = ?5",
            rusqlite::params![
                id.to_string(),
                title,
                TitleSource::Message,
                timestamp,
                TitleSource::Fallback,
            ],
        )?;

        Ok(())
    }

    /// Names a conversation on the user's say-so.
    ///
    /// Recorded as its own source because it outranks the opening message it
    /// replaces: someone has answered this question by hand, so nothing
    /// derived from the text gets to answer it again.
    ///
    /// # Errors
    ///
    /// Fails when the update is rejected.
    pub fn name_by_user(&self, id: Uuid, title: &str) -> Result<()> {
        self.connection.execute(
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
    ///
    /// # Errors
    ///
    /// Fails when the update is rejected.
    pub fn set_pinned(&self, id: Uuid, pinned: bool) -> Result<()> {
        self.connection.execute(
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
        self.connection.execute(
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
