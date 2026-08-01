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
        let open = match self.slots.lock() {
            Ok(ledger) => Some(ledger.len()),
            Err(_poisoned) => None,
        };

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
        let opened = ledger
            .entry(session_id.to_owned())
            .or_insert_with(RunSlot::new);

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

    /// 这一帧该记到哪个槽里。
    ///
    /// 先按名字找。找不到的名字不等于错的名字：Kimi Code 与 Claude Code 的子代理
    /// 在它自己的会话号下汇报（父会话只留一条 tool_call），而那个号不是本客户端
    /// 开出来的 —— `slot` 对它一律交回 None，于是子代理的每一帧、连同它的每一次
    /// 授权请求，都在到达的那一刻消失，屏幕上只剩一张永远转圈的卡片。
    ///
    /// 回落的去处是此刻唯一在听的那条会话。两条以上同时在飞时宁可不认：一帧只有
    /// 在归属明确时才该被认领，猜错归属比丢掉更糟。Zed 在
    /// `crates/agent_servers/src/acp.rs` 里同样坚持"到达的通知必须有归属"，
    /// 它的办法是装载前先登记；我们这一侧登记不了对面自己开的号，所以在这里回落。
    ///
    /// # Errors
    ///
    /// Fails when the lock was poisoned by a panic elsewhere.
    pub fn route(&self, session_id: &str) -> Result<Option<RunSlot>> {
        let ledger = self.book()?;

        if let Some(known) = ledger.get(session_id) {
            return Ok(Some(known.clone()));
        }

        let mut listening = ledger.values().filter(|slot| slot.is_listening());
        let sole = listening.next().filter(|_only| listening.next().is_none());

        Ok(sole.cloned())
    }

    fn book(&self) -> Result<MutexGuard<'_, HashMap<String, RunSlot>>> {
        self.slots.lock().map_err(|_poisoned| AcpError::Protocol {
            message: POISONED.to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    // 与 recorder.rs 的 mod tests 同一条纪律、同一个理由：仓库根没有 clippy.toml，
    // 放开一直是逐处写出来的。
    #![allow(
        clippy::expect_used,
        reason = "a test proves itself by panicking, so a failed step must fail the test"
    )]

    use super::SessionBook;
    use crate::recorder::Recorder;
    use crate::run_slot::{Listening, RunSlot};

    const NAME: &str = "session_33333333-3333-4333-8333-333333333333";

    #[test]
    fn a_frame_from_an_unopened_session_routes_to_the_only_run_in_flight() {
        let book = SessionBook::new();
        let slot = book.open(NAME).expect("the book is writable");

        slot.install(Listening::Turn(Recorder::new(
            NAME.to_owned(),
            slot.seq(),
            Box::new(|_event| {}),
        )))
        .expect("the slot is empty");

        assert!(
            matches!(book.route("session_child"), Ok(Some(_))),
            "子代理的会话号不在册子里，但这一刻只有一轮在飞，它有归属"
        );
    }

    #[test]
    fn a_frame_from_an_unopened_session_is_not_guessed_at_when_nobody_is_listening() {
        let book = SessionBook::new();

        assert!(book.open(NAME).is_ok());
        assert!(matches!(book.route("session_child"), Ok(None)));
    }

    #[test]
    fn an_adopted_slot_answers_under_its_session_name() {
        let book = SessionBook::new();

        assert!(book.adopt(NAME, RunSlot::new()).is_ok());
        assert!(matches!(book.slot(NAME), Ok(Some(_))));
    }

    #[test]
    fn adopting_a_known_name_does_not_open_a_second_session() {
        let book = SessionBook::new();

        assert!(book.open(NAME).is_ok());
        assert!(book.adopt(NAME, RunSlot::new()).is_ok());
        assert!(matches!(book.open_count(), Ok(1)));
    }
}
