#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    reason = "a test proves itself by panicking, so a failed step must fail the test"
)]
//! The seam between a connection-lived handler and a run-lived recorder.
//!
//! The driver itself needs an agent process, so what is covered here is the
//! part that decides which run an update belongs to. Getting that wrong would
//! attribute frames to the previous turn, which no compiler would catch.


use std::sync::{Arc, Mutex};

use agent_client_protocol::schema::v1::{SessionNotification, SessionUpdate, ToolCall};
use poietica_ai_acp_native::{AcpError, RecordedEvent, Recorder, RunSlot};
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
    let thread_id = store.create_thread("slot fixture").expect("a thread");
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

fn announcement() -> SessionNotification {
    SessionNotification::new(
        "sess_alpha",
        SessionUpdate::ToolCall(ToolCall::new("call_001", "Read config.toml")),
    )
}

#[test]
fn an_update_outside_a_turn_is_dropped() {
    let slot = RunSlot::new();

    assert!(!slot.is_recording());
    assert!(
        !slot.record(|recorder| recorder.record_session_update(&announcement())),
        "an update between turns belongs to no run"
    );
}

#[test]
fn updates_reach_the_installed_run() {
    let fixture = fixture();
    let observed = Arc::clone(&fixture.observed);
    let slot = RunSlot::new();

    slot.install(fixture.recorder).expect("an empty slot");

    assert!(slot.is_recording());
    assert!(slot.record(|recorder| recorder.record_run_started("sess_alpha")));
    assert!(slot.record(|recorder| recorder.record_session_update(&announcement())));

    let seen = observed.lock().expect("the sink");

    assert_eq!(seen.len(), 2);
    assert_eq!(
        seen.first().map(|event| event.kind.clone()),
        Some("run_started".to_owned())
    );
    assert!(
        seen.get(1)
            .and_then(|event| event.frame.get("notification"))
            .is_some(),
        "the update frame keeps the shape the interface validates"
    );
}

#[test]
fn a_second_run_cannot_displace_the_first() {
    let first = fixture();
    let second = fixture();
    let slot = RunSlot::new();

    slot.install(first.recorder).expect("an empty slot");

    let error = slot
        .install(second.recorder)
        .expect_err("an occupied slot refuses a second run");

    assert!(
        matches!(error, AcpError::Protocol { .. }),
        "a concurrent turn is refused, not silently interleaved"
    );
}

#[test]
fn taking_the_run_ends_the_routing() {
    let fixture = fixture();
    let slot = RunSlot::new();

    slot.install(fixture.recorder).expect("an empty slot");

    let taken = slot.take().expect("the slot").expect("a run to close out");

    assert!(!slot.is_recording());
    assert!(
        !slot.record(|recorder| recorder.record_session_update(&announcement())),
        "the turn is over, so nothing else may be attributed to it"
    );

    drop(taken);
}
