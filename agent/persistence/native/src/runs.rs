//! Turns: opening one, and recording how it ended.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::Result;
use crate::store::{AiStore, now};

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

impl AiStore {
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
