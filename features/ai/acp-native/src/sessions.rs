//! Which session an update belongs to.
//!
//! One agent process can hold several sessions at once, and every frame the
//! agent sends names the session it belongs to. This book is that name
//! resolved: one slot per session, so a frame is recorded against the run
//! that asked for it rather than against whichever run started last.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard};

use crate::error::{AcpError, Result};
use crate::run_slot::RunSlot;

const POISONED: &str = "the session book lock was poisoned";

/// The open sessions of one agent process, keyed by protocol session id.
///
/// Cheap to clone: every clone reads and writes the same book.
#[derive(Clone, Default)]
pub struct SessionBook {
    slots: Arc<Mutex<HashMap<String, RunSlot>>>,
}

/// The contents are recorders, which are not printable, so the count is.
impl fmt::Debug for SessionBook {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let open = self.slots.lock().map(HashMap::len).ok();

        formatter
            .debug_struct("SessionBook")
            .field("open", &open)
            .finish()
    }
}

impl SessionBook {
    /// An empty book.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The slot of a session, opened on first mention.
    ///
    /// # Errors
    ///
    /// Fails when the lock was poisoned by a panic elsewhere.
    pub fn open(&self, session_id: &str) -> Result<RunSlot> {
        let mut ledger = self.book()?;
        let opened = ledger.entry(session_id.to_owned()).or_insert_with(RunSlot::new);

        Ok(opened.clone())
    }

    /// The slot of a session already open, and nothing for any other name.
    ///
    /// A frame naming a session this client never opened is not ours to
    /// record, so the caller is told plainly instead of being handed a slot.
    ///
    /// # Errors
    ///
    /// Fails when the lock was poisoned by a panic elsewhere.
    pub fn slot(&self, session_id: &str) -> Result<Option<RunSlot>> {
        Ok(self.book()?.get(session_id).cloned())
    }

    /// Forgets a session, reporting whether it was open.
    ///
    /// # Errors
    ///
    /// Fails when the lock was poisoned by a panic elsewhere.
    pub fn close(&self, session_id: &str) -> Result<bool> {
        Ok(self.book()?.remove(session_id).is_some())
    }

    /// How many sessions are open.
    ///
    /// # Errors
    ///
    /// Fails when the lock was poisoned by a panic elsewhere.
    pub fn open_count(&self) -> Result<usize> {
        Ok(self.book()?.len())
    }

    /// The identifiers of the open sessions, in no order worth relying on.
    ///
    /// # Errors
    ///
    /// Fails when the lock was poisoned by a panic elsewhere.
    pub fn ids(&self) -> Result<Vec<String>> {
        Ok(self.book()?.keys().cloned().collect())
    }

    fn book(&self) -> Result<MutexGuard<'_, HashMap<String, RunSlot>>> {
        self.slots.lock().map_err(|_poisoned| AcpError::Protocol {
            message: POISONED.to_owned(),
        })
    }
}
