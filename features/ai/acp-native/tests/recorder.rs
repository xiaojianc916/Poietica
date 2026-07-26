#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    reason = "a test proves itself by panicking, so a failed step must fail the test"
)]
//! Recording, frame shape and projection behaviour, without an agent process.
//!
//! The updates here are built with the SDK's own constructors, so the shapes
//! under test are the shapes the protocol actually delivers. The assertions on
//! the frames mirror `features/ai/src/domain/acp-event-schema.ts`: if a field
//! named here is renamed there, one side fails loudly instead of silently
//! dropping frames at the boundary.

use std::sync::{Arc, Mutex};

use agent_client_protocol::schema::v1::{
    PermissionOption, PermissionOptionKind, RequestPermissionRequest, SessionNotification,
    SessionUpdate, ToolCall, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
};
use poietica_ai_acp_native::{Decision, RecordedEvent, Recorder};
use poietica_ai_persistence_native::{AiStore, DatabaseKey};
use serde_json::Value;
use tempfile::TempDir;

struct Fixture {
    _directory: TempDir,
    recorder: Recorder,
    observed: Arc<Mutex<Vec<RecordedEvent>>>,
}

fn fixture() -> Fixture {
    let directory = TempDir::new().expect("a temporary directory");
    let path = directory.path().join("ai.sqlite3");
    let key = DatabaseKey::generate();
    let store = AiStore::open_with_key(&path, &key).expect("an encrypted store");
    let thread_id = store.create_thread("recorder fixture").expect("a thread");
    let run_id = store.start_run(thread_id).expect("a run");

    let observed = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&observed);

    Fixture {
        _directory: directory,
        recorder: Recorder::new(
            store,
            run_id,
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
        "a null status would be rejected by the boundary validator"
    );

    let calls = fixture
        .recorder
        .store()
        .tool_calls_for_run(fixture.recorder.run_id())
        .expect("the projection to be readable");
    let call = calls.first().expect("exactly one call");

    assert_eq!(call.title, "Editing main.rs");
    assert_eq!(
        call.status,
        poietica_ai_persistence_native::ToolCallStatus::InProgress,
        "a title change must not move the state"
    );
}

#[test]
fn a_tool_call_reaches_a_terminal_state_in_the_projection() {
    let mut fixture = fixture();

    fixture.notify(SessionUpdate::ToolCall(
        ToolCall::new("call_003", "Read config.toml")
            .kind(ToolKind::Read)
            .status(ToolCallStatus::Pending),
    ));
    fixture.notify(SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
        "call_003",
        ToolCallUpdateFields::new().status(ToolCallStatus::Completed),
    )));

    assert!(fixture.recorder.take_failure().is_none());

    let calls = fixture
        .recorder
        .store()
        .tool_calls_for_run(fixture.recorder.run_id())
        .expect("the projection to be readable");
    let call = calls.first().expect("exactly one call");

    assert_eq!(
        calls.len(),
        1,
        "one announcement plus one update is one row"
    );
    assert_eq!(
        call.status,
        poietica_ai_persistence_native::ToolCallStatus::Completed
    );
    assert!(call.ended_at.is_some());
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
    let run_id = fixture.recorder.run_id();

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

    let decision = poietica_ai_acp_native::decide(&request);

    assert!(
        matches!(&decision, Decision::Reject(option_id) if option_id.to_string() == "reject"),
        "an unattended client refuses, using the agent's own option"
    );

    let request_id = fixture.recorder.record_permission(&request, &decision);

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
        fixture
            .recorder
            .store()
            .pending_permissions(run_id)
            .expect("the projection to be readable")
            .is_empty(),
        "the request was answered as it was recorded"
    );

    let all = fixture
        .recorder
        .store()
        .permissions_for_run(run_id)
        .expect("the projection to be readable");
    let record = all.first().expect("exactly one request");

    assert_eq!(record.request_id, request_id);
    assert_eq!(
        record.outcome,
        Some(poietica_ai_persistence_native::PermissionOutcome::Denied)
    );
}

#[test]
fn an_announcement_carries_every_field_the_boundary_requires() {
    let mut fixture = fixture();

    // Both defaults at once: pending is the default status, and this call is
    // announced without a kind. The protocol omits them on the wire, and the
    // interface rejects a tool call frame that is missing either one, so the
    // recorder has to put them back.
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
