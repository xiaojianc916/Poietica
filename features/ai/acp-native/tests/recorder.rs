//! Recording and projection behaviour, without an agent process.
//!
//! The updates here are built with the SDK's own constructors, so the shapes
//! under test are the shapes the protocol actually delivers.

#![allow(clippy::expect_used)]

use std::sync::{Arc, Mutex};

use agent_client_protocol::schema::v1::{
    PermissionOption, PermissionOptionKind, RequestPermissionRequest, SessionUpdate, ToolCall,
    ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
};
use poietica_ai_acp_native::{Decision, RecordedEvent, Recorder, ACP_UPDATE, RUN_STARTED};
use poietica_ai_persistence_native::{AiStore, DatabaseKey};
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

#[test]
fn a_tool_call_is_logged_and_projected_in_step() {
    let mut fixture = fixture();
    let run_id = fixture.recorder.run_id();

    fixture.recorder.record_run_started();
    fixture
        .recorder
        .record_session_update(&SessionUpdate::ToolCall(
            ToolCall::new("call_001", "Read config.toml")
                .kind(ToolKind::Read)
                .status(ToolCallStatus::Pending),
        ));
    fixture
        .recorder
        .record_session_update(&SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
            "call_001",
            ToolCallUpdateFields::new().status(ToolCallStatus::Completed),
        )));

    assert!(
        fixture.recorder.take_failure().is_none(),
        "nothing should have failed"
    );

    let events = fixture
        .recorder
        .store()
        .events_since(run_id, 0)
        .expect("the log to be readable");

    assert_eq!(events.len(), 3);
    assert_eq!(events.first().expect("the first event").kind, RUN_STARTED);
    assert_eq!(events.last().expect("the last event").kind, ACP_UPDATE);
    assert_eq!(
        events.iter().map(|event| event.seq).collect::<Vec<_>>(),
        vec![1, 2, 3],
        "sequence numbers are dense and ordered"
    );

    let calls = fixture
        .recorder
        .store()
        .tool_calls_for_run(run_id)
        .expect("the projection to be readable");
    let call = calls.first().expect("exactly one call");

    assert_eq!(calls.len(), 1);
    assert_eq!(
        call.status,
        poietica_ai_persistence_native::ToolCallStatus::Completed
    );
    assert_eq!(call.kind, "read");
    assert!(call.ended_at.is_some());

    let forwarded = fixture.observed.lock().expect("the sink").clone();

    assert_eq!(
        forwarded.len(),
        3,
        "every durable event is forwarded exactly once"
    );
}

#[test]
fn a_title_only_update_is_still_projected() {
    let mut fixture = fixture();
    let run_id = fixture.recorder.run_id();

    fixture
        .recorder
        .record_session_update(&SessionUpdate::ToolCall(
            ToolCall::new("call_002", "Editing").status(ToolCallStatus::InProgress),
        ));
    fixture
        .recorder
        .record_session_update(&SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
            "call_002",
            ToolCallUpdateFields::new().title("Editing main.rs"),
        )));

    assert!(fixture.recorder.take_failure().is_none());

    let calls = fixture
        .recorder
        .store()
        .tool_calls_for_run(run_id)
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
fn an_update_for_an_unannounced_call_is_surfaced() {
    let mut fixture = fixture();

    fixture
        .recorder
        .record_session_update(&SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
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
        "sess_test",
        ToolCallUpdate::new("call_003", ToolCallUpdateFields::new()),
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
