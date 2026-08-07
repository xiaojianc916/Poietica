#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    reason = "a test proves itself by panicking, so a failed step must fail the test"
)]
//! The permission round-trip, without an agent process.
//!
//! The desk is the only thing standing between an answer typed by a user and a
//! reply sent to an agent, so the cases that matter here are the dishonest
//! ones: an answer nobody asked for, an option nobody offered, and a turn that
//! ended before anyone answered at all.
//!
//! 一次许可请求有没有被 settle，问的是 recorder 自己那份待答清单：请求号由它
//! 铸造，答复也从它手上过，所以这件事本来就只有它知道。

mod frame_sink;

use agent_client_protocol::schema::v1::{
    PermissionOption, PermissionOptionKind, RequestPermissionRequest, ToolCallUpdate,
    ToolCallUpdateFields,
};
use futures::executor::block_on;
use poietica_agent_runtime_native::{Decision, PermissionDesk};

use frame_sink::{SESSION, recording, text_of};

fn request() -> RequestPermissionRequest {
    RequestPermissionRequest::new(
        SESSION,
        ToolCallUpdate::new(
            "call_100",
            ToolCallUpdateFields::new().title("Write src/main.rs"),
        ),
        vec![
            PermissionOption::new("allow", "Allow", PermissionOptionKind::AllowOnce),
            PermissionOption::new("always", "Always allow", PermissionOptionKind::AllowAlways),
            PermissionOption::new("reject", "Reject", PermissionOptionKind::RejectOnce),
        ],
    )
}

#[test]
fn an_answer_reaches_the_waiting_handler() {
    let desk = PermissionDesk::new();
    let waiting = desk.wait("req_1", &request()).expect("a fresh desk");

    desk.answer("req_1", "allow").expect("the answer to land");

    assert_eq!(
        block_on(waiting).expect("an answer"),
        Decision::Allow("allow".into()),
        "the agent's own classification decides what allowing means"
    );
    assert_eq!(desk.waiting(), 0, "an answered request leaves the desk");
}

#[test]
fn an_option_that_was_never_offered_is_refused() {
    let desk = PermissionDesk::new();
    let waiting = desk.wait("req_2", &request()).expect("a fresh desk");

    assert!(
        desk.answer("req_2", "sudo").is_err(),
        "the interface does not get to invent options"
    );
    assert_eq!(
        desk.waiting(),
        1,
        "a nonsensical answer must not destroy a request that is still waiting"
    );

    desk.answer("req_2", "reject").expect("the real answer");

    assert_eq!(
        block_on(waiting).expect("an answer"),
        Decision::Reject("reject".into())
    );
}

#[test]
fn an_answer_to_an_unknown_request_is_refused() {
    let desk = PermissionDesk::new();

    assert!(desk.answer("req_404", "allow").is_err());
}

#[test]
fn a_turn_that_ends_first_cancels_the_wait() {
    let desk = PermissionDesk::new();
    let waiting = desk.wait("req_3", &request()).expect("a fresh desk");

    desk.clear();

    assert!(
        block_on(waiting).is_err(),
        "the handler observes the abandonment and answers with a cancellation"
    );
    assert_eq!(desk.waiting(), 0);
}

#[test]
fn a_request_and_its_answer_are_two_frames() {
    let (mut recorder, delivered) = recording();

    let request_id = recorder.record_permission_requested(&request());

    assert_eq!(
        recorder.outstanding_permissions().len(),
        1,
        "the request is outstanding for as long as the agent is blocked on it"
    );

    recorder.record_permission_resolved(&request_id, &Decision::Allow("allow".into()));

    assert!(recorder.take_failure().is_none());

    let frames = delivered.wire();

    assert_eq!(frames.len(), 2);

    let requested = frames.first().expect("the request frame");
    assert_eq!(text_of(requested, "kind"), "permission_requested");
    assert_eq!(text_of(requested, "title"), "Write src/main.rs");

    let resolved = frames.get(1).expect("the answer frame");
    assert_eq!(text_of(resolved, "kind"), "permission_resolved");
    assert_eq!(text_of(resolved, "requestId"), request_id);
    assert_eq!(text_of(resolved, "optionId"), "allow");
    assert_eq!(text_of(resolved, "outcome"), "selected");

    assert!(
        recorder.outstanding_permissions().is_empty(),
        "an answered request is no longer outstanding"
    );
}

#[test]
fn a_request_left_open_at_the_end_of_a_turn_is_settled() {
    let (mut recorder, delivered) = recording();

    let _request_id = recorder.record_permission_requested(&request());

    recorder.record_pending_cancelled();

    assert!(recorder.take_failure().is_none());
    assert!(
        recorder.outstanding_permissions().is_empty(),
        "a request nobody can ever answer must not stay outstanding"
    );

    let resolved = delivered.wire();
    let last = resolved.last().expect("the answer frame");

    assert_eq!(text_of(last, "outcome"), "cancelled");
    assert_eq!(text_of(last, "optionId"), "");
}
