#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    reason = "a test proves itself by panicking, so a failed step must fail the test"
)]
//! Recording, frame shape and projection behaviour, without an agent process.
//!
//! The updates here are built with the SDK's own constructors, so the shapes
//! under test are the shapes the protocol actually delivers. The frames are
//! defined once, by `RunFrame` in `src/frame.rs`; these assertions are what
//! pins that definition to the shape the interface reads, so a renamed field
//! fails here rather than emptying a conversation on screen.
//!
//! 断言只看帧。recorder 不写任何存储 —— 一段对话的持有者是 agent，历史由
//! session/load 交回来，所以这里没有第二份东西可以对。

use std::sync::{Arc, Mutex};

use agent_client_protocol::schema::v1::{
    PermissionOption, PermissionOptionKind, RequestPermissionRequest, SessionNotification,
    SessionUpdate, ToolCall, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
};
use poietica_agent_runtime_native::{Decision, RecordedEvent, Recorder};
use serde_json::Value;
use uuid::Uuid;

struct Fixture {
    recorder: Recorder,
    observed: Arc<Mutex<Vec<RecordedEvent>>>,
}

fn fixture() -> Fixture {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&observed);

    Fixture {
        recorder: Recorder::new(
            Uuid::now_v7(),
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
    fn frames(&self) -> Vec<Value> {
        self.observed
            .lock()
            .expect("the sink")
            .iter()
            .map(|event| event.frame.clone())
            .collect()
    }

    fn notify(&mut self, update: SessionUpdate) {
        self.recorder
            .record_session_update(&SessionNotification::new("sess_alpha", update));
    }
}

fn text_of(frame: &Value, field: &str) -> String {
    frame
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

#[test]
fn every_frame_carries_the_fields_the_interface_validates() {
    let mut fixture = fixture();

    fixture
        .recorder
        .record_run_started("sess_alpha", "read config.toml");
    fixture.notify(SessionUpdate::ToolCall(
        ToolCall::new("call_001", "Read config.toml")
            .kind(ToolKind::Read)
            .status(ToolCallStatus::Pending),
    ));
    fixture.recorder.record_run_finished("end_turn");

    assert!(fixture.recorder.take_failure().is_none());

    let frames = fixture.frames();

    assert_eq!(frames.len(), 3);

    for (position, frame) in frames.iter().enumerate() {
        assert!(frame.get("kind").is_some_and(Value::is_string), "kind");
        assert!(frame.get("seq").is_some_and(Value::is_number), "seq");
        assert!(frame.get("at").is_some_and(Value::is_number), "at");
        assert_eq!(
            frame.get("seq").and_then(Value::as_i64),
            i64::try_from(position + 1).ok(),
            "sequence numbers are dense and ordered"
        );
    }

    let started = frames.first().expect("the first frame");
    assert_eq!(text_of(started, "kind"), "run_started");
    assert_eq!(text_of(started, "sessionId"), "sess_alpha");
    assert_eq!(
        text_of(started, "prompt"),
        "read config.toml",
        "the interface reads the question from the log, not from an echo"
    );

    let update = frames.get(1).expect("the update frame");
    assert_eq!(text_of(update, "kind"), "acp_update");
    let notification = update.get("notification").expect("a notification");
    assert_eq!(text_of(notification, "sessionId"), "sess_alpha");
    let inner = notification.get("update").expect("an update");
    assert_eq!(text_of(inner, "sessionUpdate"), "tool_call");
    assert_eq!(text_of(inner, "toolCallId"), "call_001");
    assert_eq!(text_of(inner, "status"), "pending");
    assert_eq!(text_of(inner, "kind"), "read");

    let finished = frames.last().expect("the last frame");
    assert_eq!(text_of(finished, "kind"), "run_finished");
    assert_eq!(
        text_of(finished, "stopReason"),
        "end_turn",
        "the interface only accepts the protocol's own stop reasons"
    );

}

#[test]
fn an_optional_protocol_field_is_absent_rather_than_null() {
    let mut fixture = fixture();

    fixture.notify(SessionUpdate::ToolCall(
        ToolCall::new("call_002", "Editing").status(ToolCallStatus::InProgress),
    ));
    fixture.notify(SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
        "call_002",
        ToolCallUpdateFields::new().title("Editing main.rs"),
    )));

    assert!(fixture.recorder.take_failure().is_none());

    let frames = fixture.frames();
    let inner = frames
        .get(1)
        .and_then(|frame| frame.get("notification"))
        .and_then(|notification| notification.get("update"))
        .expect("an update");

    assert_eq!(text_of(inner, "title"), "Editing main.rs");
    assert!(
        inner.get("status").is_none(),
        "an optional field the agent did not set is absent, not null"
    );

}

#[test]
fn an_update_for_an_unannounced_call_is_surfaced() {
    let mut fixture = fixture();

    fixture.notify(SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
        "call_404",
        ToolCallUpdateFields::new().status(ToolCallStatus::Completed),
    )));

    assert!(
        fixture.recorder.take_failure().is_some(),
        "the driver has to learn about this once the turn ends"
    );
}

#[test]
fn a_permission_request_is_refused_and_recorded() {
    let mut fixture = fixture();

    let request = RequestPermissionRequest::new(
        "sess_alpha",
        ToolCallUpdate::new(
            "call_005",
            ToolCallUpdateFields::new().title("Run cargo test"),
        ),
        vec![
            PermissionOption::new("allow", "Allow", PermissionOptionKind::AllowOnce),
            PermissionOption::new("reject", "Reject", PermissionOptionKind::RejectOnce),
        ],
    );

    let decision = poietica_agent_runtime_native::decide(&request);

    assert!(
        matches!(&decision, Decision::Reject(option_id) if option_id.to_string() == "reject"),
        "an unattended client refuses, using the agent's own option"
    );

    /* 按生产路径的顺序来。driver.rs 先记下问题，再记下答复，中间隔着一次
    等待；此前这里调的是把两步并成一步的便利方法，而那个方法在生产代码里
    一处都没有被调用过 —— 它注释里点名的两种场景（请求落在一轮之外、桌子
    不可用），driver.rs 走的都是这两步。一个只有自己的测试在调用的生产方法
    证明不了生产行为，所以方法没了，顺序留下。 */
    let request_id = fixture.recorder.record_permission_requested(&request);
    fixture
        .recorder
        .record_permission_resolved(&request_id, &decision);

    assert!(fixture.recorder.take_failure().is_none());

    let frames = fixture.frames();
    let requested = frames.first().expect("the request frame");

    assert_eq!(text_of(requested, "kind"), "permission_requested");
    assert_eq!(text_of(requested, "requestId"), request_id);
    assert_eq!(text_of(requested, "toolCallId"), "call_005");
    assert_eq!(
        text_of(requested, "title"),
        "Run cargo test",
        "the interface requires a title even though the protocol does not"
    );

    let option = requested
        .get("options")
        .and_then(|options| options.get(0))
        .expect("the first option");

    assert_eq!(text_of(option, "optionId"), "allow");
    assert_eq!(text_of(option, "kind"), "allow_once");
    assert_eq!(text_of(option, "name"), "Allow");

    let resolved = frames.get(1).expect("the answer frame");

    assert_eq!(text_of(resolved, "kind"), "permission_resolved");
    assert_eq!(text_of(resolved, "requestId"), request_id);
    assert_eq!(text_of(resolved, "optionId"), "reject");
    assert_eq!(
        text_of(resolved, "outcome"),
        "selected",
        "refusing by choosing a refusal option is a selection, not a cancellation"
    );

    assert!(
        fixture.recorder.outstanding_permissions().is_empty(),
        "the request was answered as it was recorded"
    );
}

#[test]
fn an_announcement_carries_every_field_the_boundary_requires() {
    let mut fixture = fixture();

    // Both defaults at once: pending is the default status, and this call is
    // announced without a kind. Serialisation omits them, and the interface
    // draws a card with no title and no icon if they stay omitted, so the
    // recorder puts them back from the SDK's own values.
    fixture.notify(SessionUpdate::ToolCall(ToolCall::new(
        "call_006",
        "Read config.toml",
    )));

    assert!(fixture.recorder.take_failure().is_none());

    let frames = fixture.frames();
    let inner = frames
        .first()
        .and_then(|frame| frame.get("notification"))
        .and_then(|notification| notification.get("update"))
        .expect("an update");

    assert_eq!(text_of(inner, "toolCallId"), "call_006");
    assert_eq!(text_of(inner, "title"), "Read config.toml");
    assert_eq!(
        text_of(inner, "status"),
        "pending",
        "a default status is still a status the interface demands"
    );
    assert!(
        !text_of(inner, "kind").is_empty(),
        "a default kind is still a kind the interface demands"
    );
}
