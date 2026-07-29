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

    /// Reads the most recent turns of a conversation, frame by frame.
    ///
    /// A window, not the whole log. One frame is a streamed fragment of a few
    /// characters, so a conversation that has been used for a while holds tens
    /// of thousands of them; reading all of them meant opening a conversation
    /// cost time proportional to everything ever said in it, parsed once here
    /// and replayed once in the interface. No chat client opens a conversation
    /// that way, and the cost landed on the click.
    ///
    /// The window is cut by turn rather than by frame, because half a turn is
    /// not a thing anyone should be shown. Within it, runs are ordered by when
    /// they started and frames by their position inside the run, which is the
    /// order they happened in.
    ///
    /// # Errors
    ///
    /// Fails when a row cannot be read or a payload cannot be decoded.
    pub fn thread_events(&self, thread_id: Uuid, recent_runs: i64) -> Result<Vec<StoredEvent>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT run_events.seq, run_events.kind, run_events.payload, run_events.recorded_at
               FROM run_events
               JOIN runs ON runs.id = run_events.run_id
              WHERE runs.thread_id = ?1
                AND runs.id IN (
                      SELECT id
                        FROM runs
                       WHERE thread_id = ?1
                       ORDER BY started_at DESC, id DESC
                       LIMIT ?2
                    )
              ORDER BY runs.started_at, runs.id, run_events.seq",
        )?;

        let rows = statement.query_map(
            rusqlite::params![thread_id.to_string(), recent_runs],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )?;

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

    /// Counts the turns a conversation holds.
    ///
    /// The read above is a window, so the interface is looking at part of a
    /// conversation and has no way to tell from the frames alone whether it is
    /// looking at all of it — the frames it would need to know that are
    /// precisely the ones the window left out. Guessing it from the ones that
    /// did arrive is how an interface ends up claiming a conversation started
    /// where it did not.
    ///
    /// One index scan over runs_thread_order, which is why it travels with
    /// every read rather than being asked for separately.
    ///
    /// # Errors
    ///
    /// Fails when the count cannot be read.
    pub fn thread_run_count(&self, thread_id: Uuid) -> Result<i64> {
        let mut statement = self
            .connection
            .prepare_cached("SELECT COUNT(*) FROM runs WHERE thread_id = ?1")?;

        let total =
            statement.query_row(rusqlite::params![thread_id.to_string()], |row| row.get(0))?;

        Ok(total)
    }
}
