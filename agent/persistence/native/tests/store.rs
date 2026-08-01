#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    reason = "a test proves itself by panicking, so a failed step must fail the test"
)]
use std::path::PathBuf;

use poietica_agent_persistence_native::{AgentStore, DatabaseKey};
use rusqlite::Connection;
use tempfile::TempDir;

/// 明文 SQLite 文件的前 16 个字节。`SQLCipher` 连这一段一起加密。
const PLAINTEXT_HEADER: &[u8] = b"SQLite format 3\0";

fn database_path(directory: &TempDir) -> PathBuf {
    directory.path().join("ai.sqlite3")
}

#[test]
fn a_conversation_is_listed_once_someone_has_spoken_in_it() {
    let directory = TempDir::new().expect("temporary directory");
    let key = DatabaseKey::generate();
    let store = AgentStore::open_with_key(&database_path(&directory), &key).expect("open");

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
fn an_old_encrypted_database_is_converted_on_open() {
    let directory = TempDir::new().expect("temporary directory");
    let path = database_path(&directory);
    let key = DatabaseKey::generate();

    // 手工造一个 SQLCipher 库。这是全仓最后一处还会写出加密文件的代码，
    // 它存在的唯一理由，就是证明已经躺在用户盘上的那种文件还救得回来。
    {
        let connection = Connection::open(&path).expect("open");

        connection
            .execute_batch(&format!("PRAGMA key = \"x'{}'\";", key.to_hex()))
            .expect("key");

        connection
            .execute_batch("CREATE TABLE probe (x INTEGER) STRICT;")
            .expect("write a page");
    }

    assert_ne!(
        std::fs::read(&path).expect("read").get(..16),
        Some(PLAINTEXT_HEADER),
        "前提没成立：造出来的这个文件本来就不是加密的，那后面那句断言什么也没测到"
    );

    let store = AgentStore::open_with_key(&path, &key).expect("open");
    let thread = store.create_thread("thread").expect("thread");

    assert!(
        store.thread(thread).expect("read").is_some(),
        "转换之后这个库要照常能读能写"
    );

    assert_eq!(
        std::fs::read(&path).expect("read").get(..16),
        Some(PLAINTEXT_HEADER),
        "开过一次之后，盘上那个文件应该已经是明文库了"
    );
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
