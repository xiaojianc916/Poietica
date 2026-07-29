//! Conversations: their names, their sessions, and their place in the list.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::Result;
use crate::store::{AiStore, now};

impl AiStore {
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
    // A conversation with no run has never been spoken in, so it is not a
    // record of anything and is left out. A run is written when a prompt is
    // sent, whether the turn then succeeds or fails, which is exactly the
    // line between a conversation that happened and one that did not.
    pub fn list_threads(&self) -> Result<Vec<ThreadSummary>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT id, session_id, title, title_source, updated_at, pinned
               FROM threads
              WHERE EXISTS (SELECT 1 FROM runs WHERE runs.thread_id = threads.id)
              ORDER BY pinned DESC, updated_at DESC",
        )?;

        let found = statement
            .query_map([], |row| {
                Ok(ThreadSummary {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    title: row.get(2)?,
                    title_source: row.get(3)?,
                    updated_at: row.get(4)?,
                    pinned: row.get::<_, i64>(5)? != 0,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(found)
    }

    /// Takes on the agent's own names for the conversations holding these
    /// sessions.
    ///
    /// An official name is the agent's own. Anything else is a stand in the
    /// interface chose while waiting, and recording which is which is what
    /// stops a stand in from replacing a real name that arrived first.
    ///
    /// Listing conversations is a read. It writes here at all only because
    /// the agent is the one authority on what a session is called, so the
    /// write is narrowed until, in the ordinary case, it is no write: the
    /// statement matches nothing when the stored name already agrees, and
    /// nothing when the user has named the conversation themselves.
    ///
    /// What it deliberately leaves alone is updated_at. That column orders
    /// the list, and being renamed is not something that happened in a
    /// conversation — the same reason set_pinned leaves it alone. Writing
    /// it here meant every refresh of the sidebar reshuffled the sidebar,
    /// and every conversation the agent still knew about claimed to have
    /// been spoken in just now.
    ///
    /// One transaction, because the alternative is one implicit transaction
    /// per name, each with its own commit to the write ahead log, for a
    /// list that usually has nothing to say.
    ///
    /// # Errors
    ///
    /// Fails when an update is rejected.
    pub fn adopt_official_titles(&self, named: &[(String, String)]) -> Result<()> {
        if named.is_empty() {
            return Ok(());
        }

        self.connection.execute_batch("BEGIN IMMEDIATE")?;

        match self.adopt_each(named) {
            Ok(()) => {
                self.connection.execute_batch("COMMIT")?;

                Ok(())
            }
            Err(error) => {
                // Best effort: the failure worth reporting is the one that
                // got us here, not whatever the rollback then says.
                let _ignored = self.connection.execute_batch("ROLLBACK");

                Err(error)
            }
        }
    }

    /// The body of the transaction above, split out so the failure path has
    /// somewhere to return to.
    ///
    /// Addressed by session_id rather than by thread: that column carries a
    /// unique index, so this is the same single lookup the old two-statement
    /// round trip paid for, with the update folded into it.
    fn adopt_each(&self, named: &[(String, String)]) -> Result<()> {
        let official = TitleSource::Official.as_str();

        let mut statement = self.connection.prepare_cached(
            "UPDATE threads
                SET title = ?2, title_source = ?3
              WHERE session_id = ?1
                AND title_source <> 'manual'
                AND (title <> ?2 OR title_source <> ?3)",
        )?;

        for (session_id, title) in named {
            statement.execute(rusqlite::params![session_id, title, official])?;
        }

        Ok(())
    }

    /// Records which agent session a thread is holding.
    ///
    /// updated_at is left alone. Reopening a conversation from a previous
    /// run makes it take a fresh session, and a conversation last spoken in
    /// a week ago is still a week old after being looked at. Touching the
    /// column here sent whatever was opened to the top of the list, which
    /// is the opposite of what opening it was for.
    ///
    /// # Errors
    ///
    /// Fails when the update is rejected.
    pub fn attach_session(&self, id: Uuid, session_id: &str) -> Result<()> {
        self.connection.execute(
            "UPDATE threads
                SET session_id = ?2
              WHERE id = ?1",
            rusqlite::params![id.to_string(), session_id],
        )?;

        Ok(())
    }

    /// Finds the agent session a conversation is holding.
    ///
    /// This is the only direction that gets asked. A conversation is
    /// picked on screen and has to find the session it is holding, which is
    /// what addressing a turn needs.
    ///
    /// The reverse — which conversation a frame belongs to — reads as though
    /// it must also be needed, and a method for it lived here for a long
    /// time saying exactly that. It was never how a frame found its
    /// conversation: a frame is filed under its run, and a run already names
    /// its thread. Its one real caller was folding the agent's own titles
    /// into the list, and that now updates by session_id directly.
    ///
    /// # Errors
    ///
    /// Fails when the query is rejected.
    pub fn session_for_thread(&self, id: Uuid) -> Result<Option<String>> {
        let mut statement = self
            .connection
            .prepare_cached("SELECT session_id FROM threads WHERE id = ?1")?;

        let mut rows = statement.query(rusqlite::params![id.to_string()])?;

        match rows.next()? {
            // The column is nullable: a conversation may exist before it
            // holds a session, which is not the same as not existing.
            Some(row) => Ok(row.get(0)?),
            None => Ok(None),
        }
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
            "SELECT id, session_id, title, title_source, updated_at, pinned
               FROM threads
              WHERE id = ?1",
        )?;

        let mut rows = statement.query(rusqlite::params![id.to_string()])?;

        match rows.next()? {
            Some(row) => Ok(Some(ThreadSummary {
                id: row.get(0)?,
                session_id: row.get(1)?,
                title: row.get(2)?,
                title_source: row.get(3)?,
                updated_at: row.get(4)?,
                pinned: row.get::<_, i64>(5)? != 0,
            })),
            None => Ok(None),
        }
    }

    /// Names a conversation after the first thing said in it.
    ///
    /// A stand in only ever replaces a stand in: the update is refused by the
    /// statement itself once a name exists, so an official title cannot be
    /// overwritten by a race rather than by a decision.
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
                TitleSource::Message.as_str(),
                timestamp,
                TitleSource::Fallback.as_str(),
            ],
        )?;

        Ok(())
    }

    /// Names a conversation on the user's say-so.
    ///
    /// This is the one name the agent does not get to replace, which is why
    /// it is recorded as its own source rather than as an official title.
    ///
    /// # Errors
    ///
    /// Fails when the update is rejected.
    pub fn name_by_user(&self, id: Uuid, title: &str) -> Result<()> {
        self.connection.execute(
            "UPDATE threads
                SET title = ?2, title_source = ?3
              WHERE id = ?1",
            rusqlite::params![id.to_string(), title, TitleSource::Manual.as_str()],
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

    /// Deletes a conversation and everything recorded under it.
    ///
    /// One statement, because the schema already says what must happen.
    /// runs reference their thread, and `run_events`, `tool_calls` and
    /// permissions all reference their run, every one of them ON DELETE
    /// CASCADE; `open_encrypted` turns foreign keys on. A single statement
    /// is atomic on its own, so there is nothing left for a transaction to
    /// hold together either.
    ///
    /// What was here before spelled out two of those four children by hand
    /// and left the other two to the very cascade it was working around.
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
    /// The name currently shown for it.
    pub title: String,
    /// Where that name came from.
    pub title_source: String,
    /// When it was last touched, in RFC 3339.
    pub updated_at: String,
    /// Whether it is held at the top of the list.
    pub pinned: bool,
}

/// Where a thread name came from.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TitleSource {
    /// The agent named it. This is the only name that is really the
    /// conversation's own.
    Official,
    /// A stand in taken from the first thing the user said.
    Message,
    /// A stand in shown before there was anything to take one from.
    Fallback,
    /// The user typed it. It is the one name a later official title does
    /// not replace, because the user has already answered that question.
    Manual,
}

impl TitleSource {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Official => "official",
            Self::Message => "message",
            Self::Fallback => "fallback",
            Self::Manual => "manual",
        }
    }
}
