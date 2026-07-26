#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    reason = "a test proves itself by panicking, so a failed step must fail the test"
)]
//! Projection behaviour of the tool call and permission tables.
//!
//! These run against a real encrypted file with a throwaway key, so nothing
//! here touches the operating system credential store.


use poietica_ai_persistence_native::{
    AiStore, DatabaseKey, PermissionOutcome, ToolCallStatus,
};
use tempfile::TempDir;
use uuid::Uuid;

struct Fixture {
    // Held so the directory outlives the connection.
    _directory: TempDir,
    store: AiStore,
    run_id: Uuid,
}

fn fixture() -> Fixture {
    let directory = TempDir::new().expect("a temporary directory");
    let path = directory.path().join("ai.sqlite3");
    let key = DatabaseKey::generate();
    let store = AiStore::open_with_key(&path, &key).expect("an encrypted store");
    let thread_id = store.create_thread("projection fixture").expect("a thread");
    let run_id = store.start_run(thread_id).expect("a run");

    Fixture {
        _directory: directory,
        store,
        run_id,
    }
}

#[test]
fn a_tool_call_moves_through_the_four_states() {
    let fixture = fixture();
    let store = &fixture.store;

    store
        .apply_tool_call(
            fixture.run_id,
            "call_001",
            "Read config.toml",
            "read",
            ToolCallStatus::Pending,
        )
        .expect("the announcement to be recorded");

    let announced = store
        .tool_calls_for_run(fixture.run_id)
        .expect("the projection to be readable");
    let first = announced.first().expect("exactly one row");

    assert_eq!(announced.len(), 1);
    assert_eq!(first.status, ToolCallStatus::Pending);
    assert_eq!(first.kind, "read");
    assert!(
        first.ended_at.is_none(),
        "a pending call has not ended yet"
    );

    assert!(
        store
            .update_tool_call(fixture.run_id, "call_001", ToolCallStatus::InProgress, None)
            .expect("the update to be applied"),
        "the update should match the announced call"
    );

    assert!(
        store
            .update_tool_call(
                fixture.run_id,
                "call_001",
                ToolCallStatus::Completed,
                Some("Read config.toml (3 KB)"),
            )
            .expect("the update to be applied"),
    );

    let settled = store
        .tool_calls_for_run(fixture.run_id)
        .expect("the projection to be readable");
    let row = settled.first().expect("exactly one row");

    assert_eq!(settled.len(), 1, "the states update one row, they do not append");
    assert_eq!(row.status, ToolCallStatus::Completed);
    assert_eq!(row.title, "Read config.toml (3 KB)");
    assert!(
        row.ended_at.is_some(),
        "a terminal state records when it ended"
    );
}

#[test]
fn a_redelivered_announcement_folds_into_one_row() {
    let fixture = fixture();
    let store = &fixture.store;

    for _attempt in 0..2 {
        store
            .apply_tool_call(
                fixture.run_id,
                "call_002",
                "Edit main.rs",
                "edit",
                ToolCallStatus::Pending,
            )
            .expect("the announcement to be recorded");
    }

    let calls = store
        .tool_calls_for_run(fixture.run_id)
        .expect("the projection to be readable");

    assert_eq!(calls.len(), 1, "a redelivered announcement is not a new call");
}

#[test]
fn an_update_without_an_announcement_is_reported_to_the_caller() {
    let fixture = fixture();

    let matched = fixture
        .store
        .update_tool_call(
            fixture.run_id,
            "call_never_announced",
            ToolCallStatus::InProgress,
            None,
        )
        .expect("the statement to run");

    assert!(!matched, "the caller must be able to see that nothing matched");
}

#[test]
fn the_status_filter_returns_only_matching_calls() {
    let fixture = fixture();
    let store = &fixture.store;

    store
        .apply_tool_call(
            fixture.run_id,
            "call_003",
            "List files",
            "read",
            ToolCallStatus::InProgress,
        )
        .expect("the announcement to be recorded");
    store
        .apply_tool_call(
            fixture.run_id,
            "call_004",
            "Run tests",
            "execute",
            ToolCallStatus::Failed,
        )
        .expect("the announcement to be recorded");

    let running = store
        .tool_calls_with_status(fixture.run_id, ToolCallStatus::InProgress)
        .expect("the projection to be readable");
    let failed = store
        .tool_calls_with_status(fixture.run_id, ToolCallStatus::Failed)
        .expect("the projection to be readable");

    assert_eq!(running.len(), 1);
    assert_eq!(running.first().expect("one row").id, "call_003");
    assert_eq!(failed.len(), 1);
    assert!(
        failed.first().expect("one row").ended_at.is_some(),
        "a call announced as failed is already terminal"
    );
}

#[test]
fn a_permission_request_is_recorded_once_and_settled_once() {
    let fixture = fixture();
    let store = &fixture.store;

    for _attempt in 0..2 {
        store
            .record_permission_request(fixture.run_id, "perm_001", Some("call_001"))
            .expect("the request to be recorded");
    }

    let outstanding = store
        .pending_permissions(fixture.run_id)
        .expect("the projection to be readable");

    assert_eq!(outstanding.len(), 1, "a redelivered request is not a new one");
    assert_eq!(
        outstanding.first().expect("one row").tool_call_id.as_deref(),
        Some("call_001")
    );

    assert!(
        store
            .resolve_permission("perm_001", PermissionOutcome::Denied)
            .expect("the answer to be written"),
        "the first answer settles the request"
    );
    assert!(
        !store
            .resolve_permission("perm_001", PermissionOutcome::Allowed)
            .expect("the statement to run"),
        "a second answer must not overwrite the first"
    );

    assert!(
        store
            .pending_permissions(fixture.run_id)
            .expect("the projection to be readable")
            .is_empty(),
        "a settled request is no longer outstanding"
    );

    let all = store
        .permissions_for_run(fixture.run_id)
        .expect("the projection to be readable");
    let record = all.first().expect("exactly one row");

    assert_eq!(record.outcome, Some(PermissionOutcome::Denied));
    assert!(record.resolved_at.is_some());
}
