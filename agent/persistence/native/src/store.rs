//! The encrypted store itself.
//!
//! Opening the file is all this module does. What can be asked of it lives
//! next to the thing being asked about: threads.rs, runs.rs and events.rs,
//! each extending this same type, in the manner projections.rs already
//! established.

use std::path::Path;

use rusqlite::Connection;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::connection::open_encrypted;
use crate::error::Result;
use crate::key::{DatabaseKey, KEY_ACCOUNT, KEY_SERVICE};
use crate::migrations::migrate;

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
}
