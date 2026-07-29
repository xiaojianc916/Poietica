//! Encrypted local storage for agent runs.
//!
//! The event log is the source of truth. Everything else in this crate is a
//! projection of it, which is what makes an interrupted run replayable: the
//! ACP client persists each session update before forwarding it, so recovery
//! is a matter of reading the log back in sequence order.

mod compaction;
mod connection;
mod error;
mod events;
mod key;
mod migrations;
mod projections;
mod runs;
mod store;
mod threads;

pub use connection::{DEFAULT_BUSY_TIMEOUT, open_encrypted};
pub use error::{Result, StoreError};
pub use events::StoredEvent;
pub use key::{DatabaseKey, KEY_ACCOUNT, KEY_SERVICE};
pub use projections::{PermissionOutcome, PermissionRecord, ToolCall, ToolCallStatus};
pub use runs::RunStatus;
pub use store::AgentStore;
pub use threads::{ThreadSummary, TitleSource};
