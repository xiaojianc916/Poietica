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

use std::sync::{Arc, Mutex};

use agent_client_protocol::schema::v1::{
    PermissionOption, PermissionOptionKind, RequestPermissionRequest, ToolCallUpdate,
    ToolCallUpdateFields,
};
use futures::executor::block_on;
use poietica_agent_runtime_native::{Decision, PermissionDesk, RecordedEvent, Recorder, SeqLine};
use serde_json::Value;

struct Fixture {
    recorder: Recorder,
    observed: Arc<Mutex<Vec<RecordedEvent>>>,
}

fn fixture() -> Fixture {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&observed);

    Fixture {
        recorder: Recorder::new(
            "sess_alpha".to_owned(),
            SeqLine::new(),
            Box::new(move |event: &RecordedEvent| {
                if let Ok(mut seen) = sink.lock() {
                    seen.push(event.clone());
                }
            }),
        ),
        observed,
    }
}

impl Fixture {
    /// 帧按 wire 形态读回来。
    ///
    /// 下面几个断言查的是 `kind`、`title`、`requestId` 这些界面读的字段名，
    /// 那是 serde 派生出来的形状，不是 Rust 的字段名，所以这里序列化一次，
    /// 让断言看到的和界面看到的是同一份 JSON。
    fn frames(&self) -> Vec<Value> {
        self.observed
            .lock()
            .expect("the sink")
            .iter()
            .map(|event| serde_json::to_value(&event.frame).expect("the frame serialises"))
            .collect()
    }
}

fn request() -> RequestPermissionRequest {
    RequestPermissionRequest::new(
        "sess_alpha",
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

fn text_of(frame: &Value, field: &str) -> String {
    frame
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
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
    let mut fixture = fixture();

    let request_id = fixture.recorder.record_permission_requested(&request());

    assert_eq!(
        fixture.recorder.outstanding_permissions().len(),
        1,
        "the request is outstanding for as long as the agent is blocked on it"
    );

    fixture
        .recorder
        .record_permission_resolved(&request_id, &Decision::Allow("allow".into()));

    assert!(fixture.recorder.take_failure().is_none());

    let frames = fixture.frames();

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
        fixture.recorder.outstanding_permissions().is_empty(),
        "an answered request is no longer outstanding"
    );
}

#[test]
fn a_request_left_open_at_the_end_of_a_turn_is_settled() {
    let mut fixture = fixture();

    let _request_id = fixture.recorder.record_permission_requested(&request());

    fixture.recorder.record_pending_cancelled();

    assert!(fixture.recorder.take_failure().is_none());
    assert!(
        fixture.recorder.outstanding_permissions().is_empty(),
        "a request nobody can ever answer must not stay outstanding"
    );

    let resolved = fixture.frames();
    let last = resolved.last().expect("the answer frame");

    assert_eq!(text_of(last, "outcome"), "cancelled");
    assert_eq!(text_of(last, "optionId"), "");
}
