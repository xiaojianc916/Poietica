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
use poietica_agent_runtime_native::{
    AcpError, Frames, Listening, RecordedEvent, Recorder, Refusal, RunSlot, SeqLine,
};

struct Fixture {
    recorder: Recorder,
    observed: Arc<Mutex<Vec<RecordedEvent>>>,
}

fn fixture() -> Fixture {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&observed);

    Fixture {
        recorder: Recorder::new(
            "sess_alpha".to_owned(),
            SeqLine::new(),
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

    assert!(!slot.is_listening());
    assert!(
        !slot.record(|listening| listening.session_update(&announcement())),
        "an update between turns belongs to no run"
    );
}

#[test]
fn updates_reach_the_installed_run() {
    let fixture = fixture();
    let observed = Arc::clone(&fixture.observed);
    let slot = RunSlot::new();

    slot.install(Listening::Turn(fixture.recorder))
        .expect("an empty slot");

    assert!(slot.is_listening());
    assert!(slot.record(|listening| {
        if let Some(recorder) = listening.turn_mut() {
            recorder.record_run_started("what the run was asked");
        }
    }));
    assert!(slot.record(|listening| listening.session_update(&announcement())));

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

    slot.install(Listening::Turn(first.recorder))
        .expect("an empty slot");

    let error = slot
        .install(Listening::Turn(second.recorder))
        .expect_err("an occupied slot refuses a second run");

    /* 拒绝一次并发的轮次是这台机器自己的规矩，不是 agent 那侧出的事，所以
    它是 Refused 而不是 Protocol。此前这里断言的是后者 —— 一条从 Refusal 这个
    变体被引进来那天起就不成立的断言，直到 live_turn.rs 编译得过、这一整个测试
    目标终于跑起来，才叫出声。 */
    assert!(
        matches!(error, AcpError::Refused(Refusal::Busy)),
        "a concurrent turn is refused, not silently interleaved"
    );
}

/// 装载一条旧会话时，槽里站的是重播听众：帧照样成形、照样投递，只是没有
/// 日志可写 —— 这一份历史的持有者是 agent。
///
/// 断言的 kind 与上面那个实时测试是同一个，这才是重点：两边不是碰巧长得像，
/// 是同一个 `acp_update` 做出来的同一种帧。
#[test]
fn a_loading_session_forwards_its_replay_without_a_log() {
    let seen: Arc<Mutex<Vec<RecordedEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    let slot = RunSlot::new();

    slot.install(Listening::Replay(Frames::new(
        "sess_alpha".to_owned(),
        slot.seq(),
        Box::new(move |event: &RecordedEvent| {
            if let Ok(mut held) = sink.lock() {
                held.push(event.clone());
            }
        }),
    )))
    .expect("an empty slot");

    assert!(
        slot.record(|listening| listening.session_update(&announcement())),
        "装载期间这条会话上有人在听"
    );

    let held = seen.lock().expect("the sink");

    assert_eq!(held.len(), 1);
    assert_eq!(
        held.first().map(|event| event.kind.clone()),
        Some("acp_update".to_owned())
    );
    assert!(
        held.first()
            .and_then(|event| event.frame.get("notification"))
            .is_some(),
        "重播帧的形状与实时帧相同"
    );
}

#[test]
fn taking_the_run_ends_the_routing() {
    let fixture = fixture();
    let slot = RunSlot::new();

    slot.install(Listening::Turn(fixture.recorder))
        .expect("an empty slot");

    let taken = slot.take().expect("the slot").expect("a run to close out");

    assert!(!slot.is_listening());
    assert!(
        !slot.record(|listening| listening.session_update(&announcement())),
        "the turn is over, so nothing else may be attributed to it"
    );

    drop(taken);
}

/// 一条会话上的第二轮接着第一轮数，而不是从头再来。
///
/// 位置的家是会话槽，不是记录器。界面按「会话内 seq 单调」去重，撞号的那一帧
/// 会被当成重复的丢掉 —— 这是把计数从轮次搬到会话时唯一会掉进去的坑。
#[test]
fn a_second_turn_continues_the_sequence_of_the_first() {
    let seen: Arc<Mutex<Vec<i64>>> = Arc::new(Mutex::new(Vec::new()));
    let slot = RunSlot::new();

    for _turn in 0..2 {
        let sink = Arc::clone(&seen);
        let recorder = Recorder::new(
            "sess_alpha".to_owned(),
            slot.seq(),
            Box::new(move |event: &RecordedEvent| {
                if let Ok(mut held) = sink.lock() {
                    held.push(event.seq);
                }
            }),
        );

        slot.install(Listening::Turn(recorder))
            .expect("an empty slot");
        assert!(slot.record(|listening| {
            if let Some(recorder) = listening.turn_mut() {
                recorder.record_run_started("what the run was asked");
            }
        }));

        let _ended = slot.take().expect("the slot");
    }

    assert_eq!(
        *seen.lock().expect("the sink"),
        vec![1, 2],
        "同一条会话上的两轮共用一条序号线"
    );
}
