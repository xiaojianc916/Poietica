//! Encrypted local storage for agent runs.
//!
//! The event log is the source of truth. Everything else in this crate is a
//! projection of it, which is what makes an interrupted run replayable: the
//! ACP client persists each session update before forwarding it, so recovery
//! is a matter of reading the log back in sequence order.

mod connection;
mod error;
mod key;
mod migrations;
mod store;

pub use connection::{open_encrypted, DEFAULT_BUSY_TIMEOUT};
pub use error::{Result, StoreError};
pub use key::{DatabaseKey, KEY_ACCOUNT, KEY_SERVICE};
pub use store::{AiStore, RunStatus, StoredEvent};
