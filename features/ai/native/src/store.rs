use std::path::Path;

use rusqlite::{Connection, ErrorCode};
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
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
    connection: Connection,
}

fn now() -> Result<String> {
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

        let rows = statement.query_map(rusqlite::params![run_id.to_string(), after_seq], |row| {
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
