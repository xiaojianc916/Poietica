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

use std::sync::{Arc, Mutex, MutexGuard};

use agent_client_protocol::schema::v1::{
    PermissionOption, PermissionOptionKind, RequestPermissionRequest, ToolCallUpdate,
    ToolCallUpdateFields,
};
use futures::executor::block_on;
use poietica_agent_runtime_native::{Decision, PermissionDesk, RecordedEvent, Recorder};
use poietica_agent_persistence_native::{AgentStore, DatabaseKey, PermissionOutcome};
use serde_json::Value;
use tempfile::TempDir;

struct Fixture {
    _directory: TempDir,
    recorder: Recorder,
    /// The same connection the recorder writes through.
    ///
    /// Reading the projections back through the writer is what forced it to
    /// hand its connection out; a reader that holds its own share needs no
    /// such door, and the sharing itself is now what the test exercises.
    store: Arc<Mutex<AgentStore>>,
    observed: Arc<Mutex<Vec<RecordedEvent>>>,
}

fn fixture() -> Fixture {
    let directory = TempDir::new().expect("a temporary directory");
    let path = directory.path().join("ai.sqlite3");
    let key = DatabaseKey::generate();
    let store = AgentStore::open_with_key(&path, &key).expect("an encrypted store");
    let thread_id = store.create_thread("desk fixture").expect("a thread");
    let run_id = store.start_run(thread_id).expect("a run");
    let store = Arc::new(Mutex::new(store));

    let observed = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&observed);

    Fixture {
        _directory: directory,
        recorder: Recorder::new(
            Arc::clone(&store),
            run_id,
            Box::new(move |event: &RecordedEvent| {
                if let Ok(mut seen) = sink.lock() {
                    seen.push(event.clone());
                }
            }),
        ),
        store,
        observed,
    }
}

impl Fixture {
    /// The projections, for the length of one assertion.
    fn store(&self) -> MutexGuard<'_, AgentStore> {
        self.store.lock().expect("the store")
    }

    fn frames(&self) -> Vec<Value> {
        self.observed
            .lock()
            .expect("the sink")
            .iter()
            .map(|event| event.frame.clone())
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
    let run_id = fixture.recorder.run_id();

    let request_id = fixture.recorder.record_permission_requested(&request());

    assert_eq!(
        fixture
            .store()
            .pending_permissions(run_id)
            .expect("the projection to be readable")
            .len(),
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

    let record = fixture
        .store()
        .permissions_for_run(run_id)
        .expect("the projection to be readable")
        .first()
        .cloned()
        .expect("exactly one request");

    assert_eq!(record.outcome, Some(PermissionOutcome::Allowed));
}

#[test]
fn a_request_left_open_at_the_end_of_a_turn_is_settled() {
    let mut fixture = fixture();
    let run_id = fixture.recorder.run_id();

    let _request_id = fixture.recorder.record_permission_requested(&request());

    fixture.recorder.record_pending_cancelled();

    assert!(fixture.recorder.take_failure().is_none());
    assert!(
        fixture
            .store()
            .pending_permissions(run_id)
            .expect("the projection to be readable")
            .is_empty(),
        "the log must not keep a request nobody can ever answer"
    );

    let resolved = fixture.frames();
    let last = resolved.last().expect("the answer frame");

    assert_eq!(text_of(last, "outcome"), "cancelled");
    assert_eq!(text_of(last, "optionId"), "");
}
