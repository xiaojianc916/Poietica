//! Queryable projections over the event log.
//!
//! `run_events` stays the source of truth. The rows written here exist so a
//! caller can ask what a run is doing right now without replaying the whole
//! log, and every one of them can be rebuilt from that log. A bug in this
//! module therefore costs a rebuild, never data.

use std::error::Error as StdError;
use std::fmt;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ValueRef};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::Result;
use crate::store::{AgentStore, now};

/// The four tool call states defined by the Agent Client Protocol.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    /// Reported but not started: the input is still streaming in, or the call
    /// is waiting for the user to approve it.
    Pending,
    /// Running.
    InProgress,
    /// Finished successfully.
    Completed,
    /// Finished unsuccessfully.
    Failed,
}

impl ToolCallStatus {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    fn from_column(text: &str) -> Option<Self> {
        match text {
            "pending" => Some(Self::Pending),
            "in_progress" => Some(Self::InProgress),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }

    /// Whether the state is final, which is the single thing that decides
    /// whether an end timestamp is written.
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed)
    }
}

/// How a permission request was settled.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionOutcome {
    /// The user approved it.
    Allowed,
    /// The user refused it.
    Denied,
    /// The turn ended before the user answered.
    Cancelled,
}

impl PermissionOutcome {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Allowed => "allowed",
            Self::Denied => "denied",
            Self::Cancelled => "cancelled",
        }
    }

    fn from_column(text: &str) -> Option<Self> {
        match text {
            "allowed" => Some(Self::Allowed),
            "denied" => Some(Self::Denied),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

/// A stored value that no longer matches the enum it projects into.
///
/// The schema constrains both columns, so reaching this means the file was
/// written by a different version of this crate. Saying so with the column
/// name and the offending value is more useful than falling back to a default
/// and pretending the row is fine.
#[derive(Debug)]
struct UnknownValue {
    column: &'static str,
    value: String,
}

impl fmt::Display for UnknownValue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "unrecognised {} value: {}",
            self.column, self.value
        )
    }
}

impl StdError for UnknownValue {}

impl FromSql for ToolCallStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text = value.as_str()?;

        Self::from_column(text).ok_or_else(|| {
            FromSqlError::Other(Box::new(UnknownValue {
                column: "tool_calls.status",
                value: text.to_owned(),
            }))
        })
    }
}

impl FromSql for PermissionOutcome {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text = value.as_str()?;

        Self::from_column(text).ok_or_else(|| {
            FromSqlError::Other(Box::new(UnknownValue {
                column: "permissions.outcome",
                value: text.to_owned(),
            }))
        })
    }
}

/// A tool call as currently projected.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ToolCall {
    /// The identifier the agent assigned to the call.
    pub id: String,
    /// Human readable label, which the agent may refine as the call proceeds.
    pub title: String,
    /// The category the agent reported, such as read or edit.
    pub kind: String,
    /// Current state.
    pub status: ToolCallStatus,
    /// When the call was first seen, in RFC 3339.
    pub started_at: String,
    /// When the call reached a final state, in RFC 3339.
    pub ended_at: Option<String>,
}

/// A permission request as currently projected.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PermissionRecord {
    /// The identifier of the request the agent is waiting on.
    pub request_id: String,
    /// The tool call the request belongs to, when the agent named one.
    pub tool_call_id: Option<String>,
    /// How it was settled, or nothing while it is still outstanding.
    pub outcome: Option<PermissionOutcome>,
    /// When the request arrived, in RFC 3339.
    pub requested_at: String,
    /// When it was settled, in RFC 3339.
    pub resolved_at: Option<String>,
}

fn read_tool_call(row: &rusqlite::Row<'_>) -> rusqlite::Result<ToolCall> {
    Ok(ToolCall {
        id: row.get(0)?,
        title: row.get(1)?,
        kind: row.get(2)?,
        status: row.get(3)?,
        started_at: row.get(4)?,
        ended_at: row.get(5)?,
    })
}

fn read_permission(row: &rusqlite::Row<'_>) -> rusqlite::Result<PermissionRecord> {
    Ok(PermissionRecord {
        request_id: row.get(0)?,
        tool_call_id: row.get(1)?,
        outcome: row.get(2)?,
        requested_at: row.get(3)?,
        resolved_at: row.get(4)?,
    })
}

const TOOL_CALL_COLUMNS: &str = "id, title, kind, status, started_at, ended_at";
const PERMISSION_COLUMNS: &str = "request_id, tool_call_id, outcome, requested_at, resolved_at";

// the projections are a separate concern from opening the store, and keeping them in their own
// file is what keeps both files readable
impl AgentStore {
    /// Records a tool call the agent just announced.
    ///
    /// A redelivered announcement folds into the existing row rather than
    /// failing, because the protocol permits the same call to be described
    /// more than once as its input streams in.
    ///
    /// # Errors
    ///
    /// Fails when the write is rejected or the clock cannot be formatted.
    pub fn apply_tool_call(
        &self,
        run_id: Uuid,
        tool_call_id: &str,
        title: &str,
        kind: &str,
        status: ToolCallStatus,
    ) -> Result<()> {
        let timestamp = now()?;
        let ended_at = if status.is_terminal() {
            Some(timestamp.clone())
        } else {
            None
        };

        self.connection.execute(
            "INSERT INTO tool_calls (id, run_id, title, kind, status, started_at, ended_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (run_id, id) DO UPDATE SET
                 title = excluded.title,
                 kind = excluded.kind,
                 status = excluded.status,
                 ended_at = excluded.ended_at",
            rusqlite::params![
                tool_call_id,
                run_id.to_string(),
                title,
                kind,
                status.as_str(),
                timestamp,
                ended_at,
            ],
        )?;

        Ok(())
    }

    /// Applies a progress update to a tool call that is already known.
    ///
    /// Returns whether a row matched. An update can legitimately arrive before
    /// the announcement it belongs to, and the caller is the only party that
    /// can decide what to do about it, so this reports the miss instead of
    /// inventing a row or failing outright.
    ///
    /// # Errors
    ///
    /// Fails when the write is rejected or the clock cannot be formatted.
    pub fn update_tool_call(
        &self,
        run_id: Uuid,
        tool_call_id: &str,
        status: ToolCallStatus,
        title: Option<&str>,
    ) -> Result<bool> {
        let ended_at = if status.is_terminal() {
            Some(now()?)
        } else {
            None
        };

        let affected = self.connection.execute(
            "UPDATE tool_calls
                SET status = ?3,
                    title = COALESCE(?4, title),
                    ended_at = COALESCE(?5, ended_at)
              WHERE run_id = ?1 AND id = ?2",
            rusqlite::params![
                run_id.to_string(),
                tool_call_id,
                status.as_str(),
                title,
                ended_at,
            ],
        )?;

        Ok(affected == 1)
    }

    /// Reads every tool call of a run in the order they were announced.
    ///
    /// # Errors
    ///
    /// Fails when a row cannot be read.
    pub fn tool_calls_for_run(&self, run_id: Uuid) -> Result<Vec<ToolCall>> {
        let statement = format!(
            "SELECT {TOOL_CALL_COLUMNS}
               FROM tool_calls
              WHERE run_id = ?1
              ORDER BY started_at, id"
        );

        let mut prepared = self.connection.prepare_cached(&statement)?;
        let rows = prepared.query_map(rusqlite::params![run_id.to_string()], read_tool_call)?;

        let mut calls = Vec::new();

        for row in rows {
            calls.push(row?);
        }

        Ok(calls)
    }

    /// Reads the tool calls of a run that are in one particular state.
    ///
    /// # Errors
    ///
    /// Fails when a row cannot be read.
    pub fn tool_calls_with_status(
        &self,
        run_id: Uuid,
        status: ToolCallStatus,
    ) -> Result<Vec<ToolCall>> {
        let statement = format!(
            "SELECT {TOOL_CALL_COLUMNS}
               FROM tool_calls
              WHERE run_id = ?1 AND status = ?2
              ORDER BY started_at, id"
        );

        let mut prepared = self.connection.prepare_cached(&statement)?;
        let rows = prepared.query_map(
            rusqlite::params![run_id.to_string(), status.as_str()],
            read_tool_call,
        )?;

        let mut calls = Vec::new();

        for row in rows {
            calls.push(row?);
        }

        Ok(calls)
    }

    /// Applies a title change to a tool call without touching its state.
    ///
    /// The protocol allows an update that carries a new title and no status,
    /// and dropping those would leave the projection showing a stale label.
    ///
    /// Returns whether a row matched.
    ///
    /// # Errors
    ///
    /// Fails when the write is rejected.
    pub fn rename_tool_call(&self, run_id: Uuid, tool_call_id: &str, title: &str) -> Result<bool> {
        let affected = self.connection.execute(
            "UPDATE tool_calls
                SET title = ?3
              WHERE run_id = ?1 AND id = ?2",
            rusqlite::params![run_id.to_string(), tool_call_id, title],
        )?;

        Ok(affected == 1)
    }

    /// Records a permission request the agent is blocked on.
    ///
    /// A redelivered request is ignored rather than reopened, so an answer
    /// that was already given cannot be lost.
    ///
    /// # Errors
    ///
    /// Fails when the write is rejected or the clock cannot be formatted.
    pub fn record_permission_request(
        &self,
        run_id: Uuid,
        request_id: &str,
        tool_call_id: Option<&str>,
    ) -> Result<()> {
        let timestamp = now()?;

        self.connection.execute(
            "INSERT INTO permissions
                 (request_id, run_id, tool_call_id, outcome, requested_at, resolved_at)
             VALUES (?1, ?2, ?3, NULL, ?4, NULL)
             ON CONFLICT (request_id) DO NOTHING",
            rusqlite::params![request_id, run_id.to_string(), tool_call_id, timestamp],
        )?;

        Ok(())
    }

    /// Settles an outstanding permission request.
    ///
    /// Returns whether this call was the one that settled it. A second answer
    /// to the same request is refused, which is what keeps a late user click
    /// from overwriting a cancellation.
    ///
    /// # Errors
    ///
    /// Fails when the write is rejected or the clock cannot be formatted.
    pub fn resolve_permission(&self, request_id: &str, outcome: PermissionOutcome) -> Result<bool> {
        let timestamp = now()?;

        let affected = self.connection.execute(
            "UPDATE permissions
                SET outcome = ?2, resolved_at = ?3
              WHERE request_id = ?1 AND outcome IS NULL",
            rusqlite::params![request_id, outcome.as_str(), timestamp],
        )?;

        Ok(affected == 1)
    }

    /// Reads every permission request of a run.
    ///
    /// # Errors
    ///
    /// Fails when a row cannot be read.
    pub fn permissions_for_run(&self, run_id: Uuid) -> Result<Vec<PermissionRecord>> {
        let statement = format!(
            "SELECT {PERMISSION_COLUMNS}
               FROM permissions
              WHERE run_id = ?1
              ORDER BY requested_at, request_id"
        );

        let mut prepared = self.connection.prepare_cached(&statement)?;
        let rows = prepared.query_map(rusqlite::params![run_id.to_string()], read_permission)?;

        let mut records = Vec::new();

        for row in rows {
            records.push(row?);
        }

        Ok(records)
    }

    /// Reads the permission requests of a run that nobody has answered yet.
    ///
    /// # Errors
    ///
    /// Fails when a row cannot be read.
    pub fn pending_permissions(&self, run_id: Uuid) -> Result<Vec<PermissionRecord>> {
        let statement = format!(
            "SELECT {PERMISSION_COLUMNS}
               FROM permissions
              WHERE run_id = ?1 AND outcome IS NULL
              ORDER BY requested_at, request_id"
        );

        let mut prepared = self.connection.prepare_cached(&statement)?;
        let rows = prepared.query_map(rusqlite::params![run_id.to_string()], read_permission)?;

        let mut records = Vec::new();

        for row in rows {
            records.push(row?);
        }

        Ok(records)
    }
}
