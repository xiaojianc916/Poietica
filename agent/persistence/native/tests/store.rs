#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    reason = "a test proves itself by panicking, so a failed step must fail the test"
)]
use std::path::PathBuf;

use poietica_agent_persistence_native::{AgentStore, DatabaseKey, RunStatus, StoreError};
use tempfile::TempDir;

fn database_path(directory: &TempDir) -> PathBuf {
    directory.path().join("ai.sqlite3")
}

#[test]
fn events_replay_in_sequence_order() {
    let directory = TempDir::new().expect("temporary directory");
    let key = DatabaseKey::generate();
    let store = AgentStore::open_with_key(&database_path(&directory), &key).expect("open");

    let thread = store.create_thread("first thread").expect("thread");
    let run = store.start_run(thread).expect("run");

    for seq in 1..=3 {
        store
            .append_event(run, seq, "acp_update", &serde_json::json!({ "seq": seq }))
            .expect("append");
    }

    store
        .finish_run(run, RunStatus::Finished, Some("end_turn"))
        .expect("finish");

    let events = store.events_since(run, 0).expect("read");
    let sequence: Vec<i64> = events.iter().map(|event| event.seq).collect();

    assert_eq!(sequence, vec![1, 2, 3]);

    let resumed = store.events_since(run, 1).expect("resume");
    assert_eq!(resumed.len(), 2);
}

#[test]
fn a_redelivered_event_is_rejected() {
    let directory = TempDir::new().expect("temporary directory");
    let key = DatabaseKey::generate();
    let store = AgentStore::open_with_key(&database_path(&directory), &key).expect("open");

    let thread = store.create_thread("thread").expect("thread");
    let run = store.start_run(thread).expect("run");

    store
        .append_event(run, 1, "acp_update", &serde_json::json!({}))
        .expect("first append");

    let repeated = store.append_event(run, 1, "acp_update", &serde_json::json!({}));

    assert!(matches!(repeated, Err(StoreError::DuplicateSeq { .. })));
}

#[test]
fn the_database_is_unreadable_with_another_key() {
    let directory = TempDir::new().expect("temporary directory");
    let path = database_path(&directory);

    {
        let store = AgentStore::open_with_key(&path, &DatabaseKey::generate()).expect("open");
        store.create_thread("thread").expect("thread");
    }

    let intruder = AgentStore::open_with_key(&path, &DatabaseKey::generate());

    assert!(matches!(intruder, Err(StoreError::WrongKey)));
}

#[test]
fn a_session_is_stored_with_the_agent_that_opened_it() {
    let directory = TempDir::new().expect("temporary directory");
    let key = DatabaseKey::generate();
    let store = AgentStore::open_with_key(&database_path(&directory), &key).expect("open");

    let thread = store.create_thread("thread").expect("thread");

    store
        .attach_session(thread, "session-a", "kimi")
        .expect("attach");

    let read = store.thread(thread).expect("read").expect("the thread");

    assert_eq!(read.session_id.as_deref(), Some("session-a"));
    assert_eq!(
        read.agent_id.as_deref(),
        Some("kimi"),
        "会话号只在开出它的 agent 那里认得，所以持有者必须跟着一起存下来"
    );
}

#[test]
fn a_thread_written_before_the_column_existed_has_no_owner() {
    let directory = TempDir::new().expect("temporary directory");
    let key = DatabaseKey::generate();
    let store = AgentStore::open_with_key(&database_path(&directory), &key).expect("open");

    let thread = store.create_thread("thread").expect("thread");
    let read = store.thread(thread).expect("read").expect("the thread");

    assert_eq!(
        read.agent_id, None,
        "还没有握住会话的对话不属于任何 agent，空值就是这个意思"
    );
}
