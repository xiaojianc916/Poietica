//! 原生侧每一帧的成本，以及它上线时有多大。
//!
//! 跑两趟做差：空 sink 那一趟是成帧本身（to_value + normalize + prune），
//! 序列化 sink 那一趟多出来的就是上线的代价。两者分开，才知道该动哪一头。
//!
//! 用的全是 crate 已经导出的公开 API，没有引入任何依赖，也没有为测量在
//! 产品代码上开任何后门。

#![allow(
    clippy::print_stdout,
    reason = "a measurement binary reports its findings on stdout"
)]
#![allow(
    clippy::expect_used,
    reason = "a measurement binary must fail loudly on a malformed fixture"
)]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use agent_client_protocol::schema::v1::SessionNotification;
use poietica_agent_runtime_native::{Frames, RecordedEvent, SeqLine};
use serde_json::json;

/// 多少帧算一次测量。一次长回答就是这个量级。
const FRAMES: u32 = 20_000;

/// 一段流式文本的典型长度。
const CHUNK: &str = "the quick brown fox jumps over the lazy dog. ";

/// 一帧会话通知，按协议的线上形状构造。
///
/// 走 serde 而不是手搓 Rust 结构：线上形状是契约，从它出发就不会因为 SDK
/// 换了字段名而悄悄测了别的东西。
fn notification() -> SessionNotification {
    serde_json::from_value(json!({
        "sessionId": "sess_bench",
        "update": {
            "sessionUpdate": "agent_message_chunk",
            "content": { "type": "text", "text": CHUNK }
        }
    }))
    .expect("the fixture matches the protocol wire shape")
}

/// 跑满 FRAMES 帧，返回耗时。
///
/// sink 由调用方给：给一个空的，量到的就是成帧；给一个序列化的，多出来的
/// 就是上线。
fn drive(sink: Box<dyn FnMut(&RecordedEvent) + Send>) -> u128 {
    let update = notification();
    let mut frames = Frames::new("sess_bench".to_owned(), SeqLine::new(), sink);
    let started = Instant::now();

    for _frame in 0..FRAMES {
        frames
            .record_session_update(&update)
            .expect("a chunk frame serialises");
    }

    started.elapsed().as_nanos()
}

fn main() {
    /* 一趟：只成帧，不上线。 */
    let shaping = drive(Box::new(|_event: &RecordedEvent| {}));

    /*
     * 另一趟：成帧之后再上线一次，这正是 Tauri 事件通道要做的事。
     *
     * sink 的生命周期是 'static，计数器只能在堆上共享 —— 真实的 sink 也一样，
     * 所以这里不是为了迁就编译器，而是照着约束写。
     */
    let bytes = Arc::new(AtomicU64::new(0));
    let counted = Arc::clone(&bytes);
    let total = drive(Box::new(move |event: &RecordedEvent| {
        let line = serde_json::to_string(event).expect("a recorded event serialises");
        let len = u64::try_from(line.len()).unwrap_or(u64::MAX);

        counted.fetch_add(len, Ordering::Relaxed);
    }));

    let frames = u128::from(FRAMES);
    let per_shape = shaping / frames;
    let per_total = total / frames;
    let payload = bytes.load(Ordering::Relaxed) / u64::from(FRAMES);
    let chunk = u64::try_from(CHUNK.len()).unwrap_or(1);

    println!("frames        {FRAMES}");
    println!("chunk bytes   {chunk}");
    println!("shape         {per_shape} ns/frame   (to_value + normalize + prune)");
    println!(
        "wire          {} ns/frame   (serde_json::to_string)",
        per_total.saturating_sub(per_shape)
    );
    println!("total         {per_total} ns/frame");
    println!("payload       {payload} bytes/frame");

    /* 整数算放大倍数，省掉浮点转换和随之而来的一串 clippy 例外。 */
    println!(
        "amplification {}.{}x   (payload / chunk bytes)",
        payload / chunk,
        (payload * 10 / chunk) % 10
    );
}
