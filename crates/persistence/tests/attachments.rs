//! 附件的账,跨一次关库开库。
//!
//! 这正是屏幕上出问题的那条路径:图片发出去的时候一切正常,重启之后不见了。
//! 所以这份测试的形状必须是「写完 → 关掉 → 重新打开 → 还在」,而不是在同一个
//! 连接上写完再读一遍 —— 后者永远是绿的,也永远证明不了任何事。

use poietica_agent_persistence_native::{AgentStore, ThreadAttachment};
use uuid::Uuid;

fn scratch() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("poietica-attachments-{}.sqlite3", Uuid::now_v7()))
}

fn image(turn: i64, ordinal: i64, hash: &str) -> ThreadAttachment {
    ThreadAttachment {
        hash: hash.to_owned(),
        turn,
        ordinal,
        mime: "image/png".to_owned(),
        byte_size: 4,
    }
}

#[test]
fn an_attachment_survives_closing_the_store() {
    let path = scratch();
    let hash = "a".repeat(64);

    let thread = {
        let mut store = AgentStore::open(&path).expect("store should open");
        let thread = store.create_thread("新建对话").expect("thread should be created");

        store
            .remember_attachment(thread, &image(0, 0, &hash))
            .expect("attachment should be recorded");

        thread
    };

    let store = AgentStore::open(&path).expect("store should reopen");
    let found = store.attachments_of(thread).expect("attachments should load");

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].hash, hash);
    assert_eq!(found[0].turn, 0);
}

#[test]
fn the_same_image_twice_is_stored_once_and_linked_twice() {
    let path = scratch();
    let hash = "b".repeat(64);

    let mut store = AgentStore::open(&path).expect("store should open");
    let thread = store.create_thread("新建对话").expect("thread should be created");

    store
        .remember_attachment(thread, &image(0, 0, &hash))
        .expect("first send should be recorded");
    store
        .remember_attachment(thread, &image(3, 0, &hash))
        .expect("second send should be recorded");

    let found = store.attachments_of(thread).expect("attachments should load");

    assert_eq!(found.len(), 2);
    assert_eq!(found[0].turn, 0);
    assert_eq!(found[1].turn, 3);

    /* 一段字节,两条链接:没有人要它之前,回收不许看见它。 */
    assert!(
        store
            .unreferenced_attachments()
            .expect("sweep should run")
            .is_empty()
    );
}

#[test]
fn deleting_a_conversation_offers_its_bytes_to_the_sweep() {
    let path = scratch();
    let hash = "c".repeat(64);

    let mut store = AgentStore::open(&path).expect("store should open");
    let thread = store.create_thread("新建对话").expect("thread should be created");

    store
        .remember_attachment(thread, &image(0, 0, &hash))
        .expect("attachment should be recorded");

    store.delete_thread(thread).expect("thread should be deleted");

    assert_eq!(
        store.unreferenced_attachments().expect("sweep should run"),
        vec![hash],
    );
}
