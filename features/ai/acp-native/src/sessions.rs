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

    /// Files a slot that already exists under a session name.
    ///
    /// The first session of a connection is created by the driver, which
    /// was handed its slot before any name existed to file it under. The
    /// book adopts that slot instead of making a second one, so there is
    /// still exactly one place a frame can be recorded.
    ///
    /// # Errors
    ///
    /// Fails when the lock was poisoned by a panic elsewhere.
    pub fn adopt(&self, session_id: &str, slot: RunSlot) -> Result<()> {
        let mut ledger = self.book()?;
        let _replaced = ledger.insert(session_id.to_owned(), slot);

        Ok(())
    }

    fn book(&self) -> Result<MutexGuard<'_, HashMap<String, RunSlot>>> {
        self.slots.lock().map_err(|_poisoned| AcpError::Protocol {
            message: POISONED.to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::SessionBook;
    use crate::run_slot::RunSlot;

    const NAME: &str = "session_33333333-3333-3333-3333-333333333333";

    #[test]
    fn an_adopted_slot_answers_under_its_session_name() {
        let book = SessionBook::new();

        let Ok(()) = book.adopt(NAME, RunSlot::new()) else {
            panic!("the book refused to adopt a slot");
        };

        let Ok(found) = book.slot(NAME) else {
            panic!("the book refused a lookup");
        };

        assert!(found.is_some(), "an adopted session must answer with its slot");
    }

    #[test]
    fn adopting_a_known_name_does_not_open_a_second_session() {
        let book = SessionBook::new();

        let Ok(_opened) = book.open(NAME) else {
            panic!("the book refused to open a session");
        };
        let Ok(()) = book.adopt(NAME, RunSlot::new()) else {
            panic!("the book refused to adopt a slot");
        };

        let Ok(open) = book.open_count() else {
            panic!("the book refused to count its sessions");
        };

        assert_eq!(open, 1, "one name is one session, however it was filed");
    }
}
