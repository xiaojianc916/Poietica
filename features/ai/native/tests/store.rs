use std::path::PathBuf;

use poietica_ai_persistence_native::{AiStore, DatabaseKey, RunStatus, StoreError};
use tempfile::TempDir;

fn database_path(directory: &TempDir) -> PathBuf {
    directory.path().join("ai.sqlite3")
}

#[test]
fn events_replay_in_sequence_order() {
    let directory = TempDir::new().expect("temporary directory");
    let key = DatabaseKey::generate();
    let store = AiStore::open_with_key(&database_path(&directory), &key).expect("open");

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
    let store = AiStore::open_with_key(&database_path(&directory), &key).expect("open");

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
        let store = AiStore::open_with_key(&path, &DatabaseKey::generate()).expect("open");
        store.create_thread("thread").expect("thread");
    }

    let intruder = AiStore::open_with_key(&path, &DatabaseKey::generate());

    assert!(matches!(intruder, Err(StoreError::WrongKey)));
}
