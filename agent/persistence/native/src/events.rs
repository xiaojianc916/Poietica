//! The event log, which is the source of truth every projection is derived
//! from. Append in sequence order, read back in the same order, and an
//! interrupted run replays exactly as it happened.

use rusqlite::ErrorCode;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{Result, StoreError};
use crate::store::{AiStore, now};

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

impl AiStore {
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
        let mut statement = self.connection.prepare_cached(
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
        let mut statement = self.connection.prepare_cached(
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
}
