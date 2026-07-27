use std::path::Path;

use rusqlite::{Connection, ErrorCode};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::connection::open_encrypted;
use crate::error::{Result, StoreError};
use crate::key::{DatabaseKey, KEY_ACCOUNT, KEY_SERVICE};
use crate::migrations::migrate;

/// Lifecycle of a single agent run.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    /// The agent is still producing updates.
    Running,
    /// The agent stopped on its own terms.
    Finished,
    /// The agent or the transport failed.
    Failed,
    /// The user stopped it.
    Cancelled,
}

impl RunStatus {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Finished => "finished",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

/// One recorded entry of the event log.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StoredEvent {
    /// Position within the run, starting at one.
    pub seq: i64,
    /// Discriminator carried by the event payload.
    pub kind: String,
    /// The event itself, as it was received.
    pub payload: serde_json::Value,
    /// When the event was written, in RFC 3339.
    pub recorded_at: String,
}

/// Owns the encrypted database.
///
/// A single writer is intentional. The log is the contention point and its
/// ordering is what everything else relies on, so serialising writes here is
/// simpler and safer than reconciling interleaved sequence numbers later.
#[derive(Debug)]
pub struct AiStore {
    pub(crate) connection: Connection,
}

pub(crate) fn now() -> Result<String> {
    Ok(OffsetDateTime::now_utc().format(&Rfc3339)?)
}

impl AiStore {
    /// Opens the store with the key held in the operating system credential
    /// store.
    ///
    /// # Errors
    ///
    /// Fails when the credential store is unavailable, the key does not fit
    /// the file, or a migration is rejected.
    pub fn open(path: &Path) -> Result<Self> {
        let key = DatabaseKey::load_or_create(KEY_SERVICE, KEY_ACCOUNT)?;
        Self::open_with_key(path, &key)
    }

    /// Opens the store with a caller supplied key, which is how the tests run
    /// without touching a real credential store.
    ///
    /// # Errors
    ///
    /// Fails when the key does not fit the file or a migration is rejected.
    pub fn open_with_key(path: &Path, key: &DatabaseKey) -> Result<Self> {
        let mut connection = open_encrypted(path, key)?;
        migrate(&mut connection)?;
        Ok(Self { connection })
    }

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

    /// Starts a run inside a thread and returns its identifier.
    ///
    /// # Errors
    ///
    /// Fails when the insert is rejected.
    pub fn start_run(&self, thread_id: Uuid) -> Result<Uuid> {
        let id = Uuid::now_v7();
        let timestamp = now()?;

        self.connection.execute(
            "INSERT INTO runs (id, thread_id, status, started_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                id.to_string(),
                thread_id.to_string(),
                RunStatus::Running.as_str(),
                timestamp,
            ],
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
        let mut statement = self.connection.prepare(
            "SELECT id, session_id, title, title_source, updated_at
               FROM threads
              WHERE EXISTS (SELECT 1 FROM runs WHERE runs.thread_id = threads.id)
              ORDER BY updated_at DESC",
        )?;

        let found = statement
            .query_map([], |row| {
                Ok(ThreadSummary {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    title: row.get(2)?,
                    title_source: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(found)
    }

    /// Names a thread, recording where the name came from.
    ///
    /// An official name is the agent's own. Anything else is a stand in the
    /// interface chose while waiting, and recording which is which is what
    /// stops a stand in from replacing a real name that arrived first.
    ///
    /// # Errors
    ///
    /// Fails when the update is rejected.
    pub fn rename_thread(&self, id: Uuid, title: &str, source: TitleSource) -> Result<()> {
        let timestamp = now()?;

        self.connection.execute(
            "UPDATE threads
                SET title = ?2, title_source = ?3, updated_at = ?4
              WHERE id = ?1",
            rusqlite::params![id.to_string(), title, source.as_str(), timestamp],
        )?;

        Ok(())
    }

    /// Records which agent session a thread is holding.
    ///
    /// # Errors
    ///
    /// Fails when the update is rejected.
    pub fn attach_session(&self, id: Uuid, session_id: &str) -> Result<()> {
        let timestamp = now()?;

        self.connection.execute(
            "UPDATE threads
                SET session_id = ?2, updated_at = ?3
              WHERE id = ?1",
            rusqlite::params![id.to_string(), session_id, timestamp],
        )?;

        Ok(())
    }

    /// Finds the thread holding one agent session.
    ///
    /// Every frame the agent sends names its session, so this is how a frame
    /// finds the conversation it belongs to.
    ///
    /// # Errors
    ///
    /// Fails when the query is rejected.
    pub fn thread_for_session(&self, session_id: &str) -> Result<Option<String>> {
        let mut statement = self
            .connection
            .prepare("SELECT id FROM threads WHERE session_id = ?1")?;

        let mut rows = statement.query(rusqlite::params![session_id])?;

        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    /// Appends an event to a run.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::DuplicateSeq`] when the sequence number was
    /// already recorded, which is how a redelivered session update is rejected.
    pub fn append_event(
        &self,
        run_id: Uuid,
        seq: i64,
        kind: &str,
        payload: &serde_json::Value,
    ) -> Result<()> {
        let encoded = serde_json::to_string(payload)?;
        let timestamp = now()?;

        let outcome = self.connection.execute(
            "INSERT INTO run_events (run_id, seq, kind, payload, recorded_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![run_id.to_string(), seq, kind, encoded, timestamp],
        );

        match outcome {
            Ok(_inserted) => Ok(()),
            Err(rusqlite::Error::SqliteFailure(failure, _message))
                if failure.code == ErrorCode::ConstraintViolation =>
            {
                Err(StoreError::DuplicateSeq {
                    run_id: run_id.to_string(),
                    seq,
                })
            }
            Err(other) => Err(other.into()),
        }
    }

    /// Reads a run's events in order, optionally resuming after a position.
    ///
    /// # Errors
    ///
    /// Fails when a row cannot be read or a payload cannot be decoded.
    pub fn events_since(&self, run_id: Uuid, after_seq: i64) -> Result<Vec<StoredEvent>> {
        let mut statement = self.connection.prepare(
            "SELECT seq, kind, payload, recorded_at
               FROM run_events
              WHERE run_id = ?1 AND seq > ?2
              ORDER BY seq",
        )?;

        let rows =
            statement.query_map(rusqlite::params![run_id.to_string(), after_seq], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?;

        let mut events = Vec::new();

        for row in rows {
            let (seq, kind, payload, recorded_at) = row?;

            events.push(StoredEvent {
                kind,
                payload: serde_json::from_str(&payload)?,
                recorded_at,
                seq,
            });
        }

        Ok(events)
    }

    /// Reads every frame of a conversation, turn by turn.
    ///
    /// A conversation is more than its last turn, so opening one has to read
    /// all of them. Runs are ordered by when they started and frames by their
    /// position inside the run, which is the order they happened in.
    ///
    /// # Errors
    ///
    /// Fails when a row cannot be read or a payload cannot be decoded.
    pub fn thread_events(&self, thread_id: Uuid) -> Result<Vec<StoredEvent>> {
        let mut statement = self.connection.prepare(
            "SELECT run_events.seq, run_events.kind, run_events.payload, run_events.recorded_at
               FROM run_events
               JOIN runs ON runs.id = run_events.run_id
              WHERE runs.thread_id = ?1
              ORDER BY runs.started_at, runs.id, run_events.seq",
        )?;

        let rows = statement.query_map(rusqlite::params![thread_id.to_string()], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;

        let mut events = Vec::new();

        for row in rows {
            let (seq, kind, payload, recorded_at) = row?;

            events.push(StoredEvent {
                kind,
                payload: serde_json::from_str(&payload)?,
                recorded_at,
                seq,
            });
        }

        Ok(events)
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

    /// Marks a run as no longer running.
    ///
    /// # Errors
    ///
    /// Fails when the update is rejected.
    pub fn finish_run(
        &self,
        run_id: Uuid,
        status: RunStatus,
        stop_reason: Option<&str>,
    ) -> Result<()> {
        let timestamp = now()?;

        self.connection.execute(
            "UPDATE runs
                SET status = ?2, stop_reason = ?3, ended_at = ?4
              WHERE id = ?1",
            rusqlite::params![run_id.to_string(), status.as_str(), stop_reason, timestamp],
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
}

impl TitleSource {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Official => "official",
            Self::Message => "message",
            Self::Fallback => "fallback",
        }
    }
}
