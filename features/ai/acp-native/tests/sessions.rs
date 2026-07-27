//! The book keeps one slot per session and forgets one at a time.

use poietica_ai_acp_native::SessionBook;

const FIRST: &str = "session_11111111-1111-1111-1111-111111111111";
const SECOND: &str = "session_22222222-2222-2222-2222-222222222222";

#[test]
fn mentioning_one_session_twice_opens_it_once() {
    let book = SessionBook::new();

    let Ok(_first) = book.open(FIRST) else {
        panic!("the book refused to open a session");
    };
    let Ok(_again) = book.open(FIRST) else {
        panic!("the book refused to open a session");
    };

    let Ok(open) = book.open_count() else {
        panic!("the book refused to count its sessions");
    };

    assert_eq!(open, 1, "one session was mentioned, so one slot is expected");
}

#[test]
fn a_name_the_book_never_opened_has_no_slot() {
    let book = SessionBook::new();

    let Ok(_opened) = book.open(FIRST) else {
        panic!("the book refused to open a session");
    };

    let Ok(found) = book.slot(SECOND) else {
        panic!("the book refused a lookup");
    };

    assert!(found.is_none(), "an unopened session must not answer with a slot");
}

#[test]
fn closing_reports_whether_the_session_was_open() {
    let book = SessionBook::new();

    let Ok(_opened) = book.open(FIRST) else {
        panic!("the book refused to open a session");
    };

    let Ok(closed) = book.close(FIRST) else {
        panic!("the book refused to close a session");
    };
    let Ok(again) = book.close(FIRST) else {
        panic!("the book refused to close a session");
    };

    assert!(closed, "the session was open, so closing it counts");
    assert!(!again, "a session is closed once, not twice");
}

#[test]
fn two_sessions_are_both_named() {
    let book = SessionBook::new();

    let Ok(_one) = book.open(FIRST) else {
        panic!("the book refused to open a session");
    };
    let Ok(_two) = book.open(SECOND) else {
        panic!("the book refused to open a session");
    };

    let Ok(mut names) = book.ids() else {
        panic!("the book refused to list its sessions");
    };
    names.sort();

    assert_eq!(names, vec![FIRST.to_owned(), SECOND.to_owned()]);
}
