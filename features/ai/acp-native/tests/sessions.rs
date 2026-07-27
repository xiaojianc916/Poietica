//! What the session book promises: one entry per name, a slot only for
//! names it was told about, and nothing left behind when one is closed.
//!
//! Every answer is asserted rather than unwrapped, because a lint-clean
//! test may not reach for a panic to describe a failure.

use poietica_ai_acp_native::SessionBook;

const FIRST: &str = "session_11111111-1111-4111-8111-111111111111";
const SECOND: &str = "session_22222222-2222-4222-8222-222222222222";

#[test]
fn mentioning_one_session_twice_opens_it_once() {
    let book = SessionBook::new();

    assert!(book.open(FIRST).is_ok());
    assert!(book.open(FIRST).is_ok());

    assert!(matches!(book.open_count(), Ok(1)));
}

#[test]
fn a_name_the_book_never_opened_has_no_slot() {
    let book = SessionBook::new();

    assert!(matches!(book.slot(FIRST), Ok(None)));
}

#[test]
fn closing_a_session_leaves_the_book_empty() {
    let book = SessionBook::new();

    assert!(book.open(FIRST).is_ok());
    assert!(book.close(FIRST).is_ok());

    assert!(matches!(book.open_count(), Ok(0)));
    assert!(matches!(book.slot(FIRST), Ok(None)));
}

#[test]
fn two_sessions_are_both_named() {
    let book = SessionBook::new();

    assert!(book.open(FIRST).is_ok());
    assert!(book.open(SECOND).is_ok());

    let names = book.ids().unwrap_or_default();

    assert!(matches!(book.open_count(), Ok(2)));
    assert!(names.iter().any(|name| name == FIRST));
    assert!(names.iter().any(|name| name == SECOND));
}
