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

fn main() {
    let update = notification();

    /* 一趟：只成帧，不上线。 */
    let mut frames = Frames::new(
        "sess_bench".to_owned(),
        SeqLine::new(),
        Box::new(|_event: &RecordedEvent| {}),
    );
    let started = Instant::now();

    for _frame in 0..FRAMES {
        frames
            .record_session_update(&update)
            .expect("a chunk frame serialises");
    }

    let shaping = started.elapsed();

    /* 另一趟：成帧之后再上线一次，这正是 Tauri 事件通道要做的事。 */
    let mut bytes: u64 = 0;
    let mut wired = Frames::new(
        "sess_bench".to_owned(),
        SeqLine::new(),
        Box::new(|event: &RecordedEvent| {
            let line = serde_json::to_string(event).expect("a recorded event serialises");

            bytes = bytes.saturating_add(line.len() as u64);
        }),
    );
    let started = Instant::now();

    for _frame in 0..FRAMES {
        wired
            .record_session_update(&update)
            .expect("a chunk frame serialises");
    }

    let total = started.elapsed();

    let per_shape = shaping.as_nanos() / u128::from(FRAMES);
    let per_total = total.as_nanos() / u128::from(FRAMES);
    let payload = f64::from(u32::try_from(bytes / u64::from(FRAMES)).unwrap_or(u32::MAX));

    println!("frames        {FRAMES}");
    println!("chunk bytes   {}", CHUNK.len());
    println!("shape         {per_shape} ns/frame   (to_value + normalize + prune)");
    println!(
        "wire          {} ns/frame   (serde_json::to_string)",
        per_total.saturating_sub(per_shape)
    );
    println!("total         {per_total} ns/frame");
    println!("payload       {payload:.0} bytes/frame");
    println!(
        "amplification {:.1}x   (payload / chunk bytes)",
        payload / CHUNK.len() as f64
    );
}
