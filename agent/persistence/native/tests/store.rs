#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    reason = "a test proves itself by panicking, so a failed step must fail the test"
)]
use std::path::PathBuf;

use poietica_agent_persistence_native::AgentStore;
use tempfile::TempDir;

fn database_path(directory: &TempDir) -> PathBuf {
    directory.path().join("ai.sqlite3")
}

#[test]
fn a_conversation_is_listed_once_someone_has_spoken_in_it() {
    let directory = TempDir::new().expect("temporary directory");
    let store = AgentStore::open(&database_path(&directory)).expect("open");

    let quiet = store.create_thread("新建对话").expect("thread");
    let spoken = store.create_thread("新建对话").expect("thread");

    store
        .name_from_message(spoken, "帮我看看这段代码")
        .expect("name");

    let listed = store.list_threads().expect("list");
    let ids: Vec<String> = listed.into_iter().map(|thread| thread.id).collect();

    assert_eq!(
        ids,
        vec![spoken.to_string()],
        "名字来自第一句话，所以还挂着占位名的那条还没有人开口"
    );
    assert!(!ids.contains(&quiet.to_string()));
}

#[test]
fn a_session_is_stored_with_the_agent_that_opened_it() {
    let directory = TempDir::new().expect("temporary directory");
    let store = AgentStore::open(&database_path(&directory)).expect("open");

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
    let store = AgentStore::open(&database_path(&directory)).expect("open");

    let thread = store.create_thread("thread").expect("thread");
    let read = store.thread(thread).expect("read").expect("the thread");

    assert_eq!(
        read.agent_id, None,
        "还没有握住会话的对话不属于任何 agent，空值就是这个意思"
    );
}
