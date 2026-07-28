#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    reason = "a test proves itself by panicking, so a failed step must fail the test"
)]
#![allow(
    clippy::print_stdout,
    reason = "this turn is driven by hand against a real agent, and its printout is"
)]
#![allow(
    clippy::similar_names,
    reason = "the recorder writes the run, and the recorded frames are read back"
)]
//! One real turn against a real agent process.
//!
//! Everything else in this crate is tested without a process, which proves the
//! recording and the projections but proves nothing about the driver: the
//! handshake, the session, the notification stream and the cancellation path
//! have never been exercised against an agent that actually exists.
//!
//! This test does that, and it is ignored by default because it spawns a
//! program, talks to a model and costs money and time. Run it deliberately:
//!
//! ```text
//! cargo test -p poietica-agent-runtime-native --test live_turn -- --ignored --nocapture
//! ```
//!
//! It is configured by the environment rather than by anything committed here,
//! so no machine's paths end up in the repository:
//!
//! - `POIETICA_ACP_COMMAND`  the agent command line (default: `kimi acp`)
//! - `POIETICA_ACP_PROMPT`   what to ask (default: a one-word reply)
//! - `POIETICA_ACP_CWD`      the session's working directory (default: a temporary one)
//! - `POIETICA_ACP_TIMEOUT`  seconds before the turn is cancelled (default: 120)
//! - `POIETICA_ACP_CAPTURE` a path to write the recorded frames to, so the
//!   renderer's schema can be tested against frames a real agent actually sent
//! - `POIETICA_ACP_EXPECT`  frame kinds and session update discriminators the
//!   turn must contain, comma separated, checked before anything is captured,
//!   and required whenever a capture is requested
//!
//! Every wait in here is two-sided. The channels the client hands back are
//! cancelled when the connection dies, and a cancelled channel says nothing
//! about why, so each wait that comes back empty asks the driver thread for the
//! actual failure before reporting anything.

use std::collections::BTreeMap;
use std::env;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use futures::channel::oneshot;
use futures::executor::block_on;
use poietica_ai_acp_native::{
    AcpError, AgentConnection, AgentSpawn, PermissionDesk, RUN_FINISHED, RUN_STARTED,
    RecordedEvent, Recorder, RunSlot, connect,
};
use poietica_ai_persistence_native::{AiStore, DatabaseKey};
use tempfile::TempDir;

const DEFAULT_COMMAND: &str = "kimi acp";
const DEFAULT_PROMPT: &str = "Reply with the single word: ready. Do not use any tools.";
const DEFAULT_TIMEOUT_SECONDS: u64 = 120;

/// What to check first when the process never came up.
const SPAWN_HINT: &str = "the agent process did not come up. check that the command runs on its \
own in a terminal, and note that on Windows a launcher installed as a script \
needs its full name, for example kimi.cmd rather than kimi. override it with \
POIETICA_ACP_COMMAND rather than editing this test";

fn setting(name: &str, fallback: &str) -> String {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback.to_owned())
}

/// The driver, and the reason it stopped.
///
/// The connection owns every channel this test waits on, so when it dies the
/// waits all fail identically and uselessly. This is where the useful answer
/// lives.
struct Driver(Option<JoinHandle<Result<(), AcpError>>>);

impl Driver {
    fn spawn(driver: impl Future<Output = Result<(), AcpError>> + Send + 'static) -> Self {
        // The crate is deliberately runtime-agnostic, so the test is its own
        // composition root: the driver gets a thread, and this thread waits.
        Self(Some(thread::spawn(move || block_on(driver))))
    }

    /// Why the connection is gone, in the driver's own words.
    fn reason(&mut self) -> String {
        match self.0.take() {
            None => "the driver had already been joined".to_owned(),
            Some(handle) => match handle.join() {
                Ok(Ok(())) => "the connection closed without reporting a failure".to_owned(),
                Ok(Err(error)) => error.to_string(),
                Err(_panicked) => "the driver thread panicked".to_owned(),
            },
        }
    }

    /// Waits for an answer, or explains the silence.
    fn expect<T>(&mut self, waiting: oneshot::Receiver<T>, what: &str) -> T {
        match block_on(waiting) {
            Ok(value) => value,
            Err(_cancelled) => {
                let reason = self.reason();

                panic!("{what}: {reason}\n\nhint: {SPAWN_HINT}")
            }
        }
    }

    fn finish(&mut self) {
        let reason = self.reason();

        assert_eq!(
            reason, "the connection closed without reporting a failure",
            "the session must end cleanly"
        );
    }
}

#[test]
#[ignore = "spawns a real agent process; run with --ignored"]
fn a_real_turn_is_recorded_exactly_as_it_is_broadcast() {
    let directory = TempDir::new().expect("a temporary directory");
    let database = directory.path().join("ai.sqlite3");
    let key = DatabaseKey::generate();
    let store = AiStore::open_with_key(&database, &key).expect("an encrypted store");
    let thread_id = store.create_thread("live turn").expect("a thread");
    let run_id = store.start_run(thread_id).expect("a run");

    // 这条连接从此被共享，而末尾重开文件读回落盘内容的断言不变：
    // 它现在还多验了一层，共享句柄没有把写留在内存里。
    let store = Arc::new(Mutex::new(store));

    let cwd = env::var("POIETICA_ACP_CWD")
        .map_or_else(|_unset| directory.path().to_path_buf(), PathBuf::from);

    let spawn = AgentSpawn {
        command: setting("POIETICA_ACP_COMMAND", DEFAULT_COMMAND),
        cwd,
    };

    let timeout = Duration::from_secs(
        setting("POIETICA_ACP_TIMEOUT", "")
            .parse::<u64>()
            .unwrap_or(DEFAULT_TIMEOUT_SECONDS),
    );

    println!("starting: {} in {}", spawn.command, spawn.cwd.display());

    let slot = RunSlot::new();
    let desk = PermissionDesk::new();

    let AgentConnection {
        client,
        session_id,
        driver,
        book: _,
    } = connect(spawn, slot, desk).expect("the command line to be usable");

    let mut driver = Driver::spawn(driver);

    let session_id = driver.expect(session_id, "the agent never created a session");

    println!("session: {session_id}");

    // Nobody is here to answer a permission request, and an agent that asks one
    // would otherwise wait forever. Cancelling is both the escape and a free
    // exercise of the cancellation path.
    let watchdog = client.clone();
    let _timer = thread::spawn(move || {
        thread::sleep(timeout);
        let _ignored = watchdog.cancel();
    });

    let (frames, observed) = mpsc::channel::<RecordedEvent>();
    let recorder = Recorder::new(
        store,
        run_id,
        Box::new(move |event: &RecordedEvent| {
            let _ignored = frames.send(event.clone());
        }),
    );

    let started = Instant::now();
    let answer = client
        .prompt(setting("POIETICA_ACP_PROMPT", DEFAULT_PROMPT), recorder)
        .expect("the driver to accept the prompt");

    let stop_reason = driver
        .expect(answer, "the turn ended without an answer")
        .expect("the turn to end without a client failure");

    println!("stopped: {stop_reason} after {:?}", started.elapsed());

    client.shutdown().expect("the session to close");

    driver.finish();

    let broadcast: Vec<RecordedEvent> = observed.try_iter().collect();

    for event in &broadcast {
        println!(
            "  {:>3} {:<12} {}",
            event.seq,
            event.kind,
            describe(&event.frame)
        );
    }

    report(&broadcast);

    // Before the capture, not after: a turn that missed what it was recording
    // must not overwrite a recording that caught it.
    require_expected(&broadcast);

    capture(&broadcast);

    let first = broadcast.first().expect("at least one frame");
    let last = broadcast.last().expect("at least one frame");

    assert_eq!(first.kind, RUN_STARTED, "a run announces itself first");
    assert_eq!(
        last.kind, RUN_FINISHED,
        "the turn must end on the agent's terms, not in a client failure"
    );

    // Reopening the file is the point: this reads what survived, not what was
    // remembered.
    let reopened = AiStore::open_with_key(&database, &key).expect("the store to reopen");
    let recorded = reopened
        .events_since(run_id, 0)
        .expect("the log to be readable");

    assert_eq!(
        recorded.len(),
        broadcast.len(),
        "every frame that was broadcast had already been written, and nothing was written twice"
    );

    for (position, (stored, sent)) in recorded.iter().zip(&broadcast).enumerate() {
        let expected = i64::try_from(position + 1).expect("a small sequence number");

        assert_eq!(stored.seq, expected, "sequence numbers are dense");
        assert_eq!(stored.seq, sent.seq);
        assert_eq!(stored.kind, sent.kind);
        assert_eq!(
            stored.payload, sent.frame,
            "a replayed run must not differ from the run as it was watched"
        );
    }

    println!("recorded {} frames, all of them durable", recorded.len());
}

/// Everything the turn actually contained.
///
/// A frame counts under its log kind, and a session update counts under its
/// protocol discriminator as well, because that is the level the timeline
/// renders at and therefore the level a fixture is judged at.
fn markers(events: &[RecordedEvent]) -> BTreeMap<String, usize> {
    let mut counted: BTreeMap<String, usize> = BTreeMap::new();

    for event in events {
        *counted.entry(event.kind.clone()).or_default() += 1;

        let discriminator = describe(&event.frame);

        if !discriminator.is_empty() {
            *counted.entry(discriminator).or_default() += 1;
        }
    }

    counted
}

/// What this turn is worth as a fixture.
fn report(events: &[RecordedEvent]) {
    println!("contains:");

    for (marker, count) in markers(events) {
        println!("  {count:>3}  {marker}");
    }
}

/// Fails when the turn is missing something it was recorded to capture.
///
/// The agent decides what to do, so a prompt that merely invites a tool call
/// is often answered from memory. Without this the run still passes, the
/// capture is still written, and the gap only surfaces much later as a
/// renderer tested against frames no agent ever sent.
fn require_expected(events: &[RecordedEvent]) {
    let present = markers(events);
    let wanted = setting("POIETICA_ACP_EXPECT", "");

    /* A capture overwrites the fixture other tests are judged against, and an
    exported variable outlives the run that needed it, so a capture path
    left in the shell is enough to replace a good recording with whatever
    the next turn happened to be. Asking what the recording is for costs one
    line and makes that impossible. */
    assert!(
        setting("POIETICA_ACP_CAPTURE", "").is_empty() || !wanted.is_empty(),
        "POIETICA_ACP_CAPTURE would replace a fixture, so POIETICA_ACP_EXPECT must say what this recording is for"
    );

    let missing = wanted
        .split(',')
        .map(str::trim)
        .filter(|marker| !marker.is_empty())
        .filter(|marker| !present.contains_key(*marker))
        .collect::<Vec<&str>>()
        .join(", ");

    assert!(
        missing.is_empty(),
        "the turn never contained: {missing}. ask for something the agent cannot know without acting, such as the contents of a named file inside POIETICA_ACP_CWD"
    );
}

/// What kind of update a frame carries.
///
/// A run of twenty identical `acp_update` lines says nothing. The interesting
/// part is the protocol's own discriminator, because those are exactly the
/// cases the timeline will have to render.
fn describe(frame: &serde_json::Value) -> String {
    frame
        .get("notification")
        .and_then(|notification| notification.get("update"))
        .and_then(|update| update.get("sessionUpdate"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_owned()
}

/// Writes the turn out, when asked.
///
/// The renderer validates every frame before it reaches the timeline, and that
/// validator has only ever been tested against frames written by hand. A
/// recording of a real turn is the only honest input for it, so this makes one
/// on request rather than inventing one.
///
/// It is written as a TypeScript module rather than as data, because the
/// package that reads it is a browser package with no filesystem and no Node
/// types. A module is imported by the same rules as any other source file,
/// which keeps a test fixture from dragging a platform into a layer that had
/// deliberately stayed out of one.
fn capture(events: &[RecordedEvent]) {
    let Ok(path) = env::var("POIETICA_ACP_CAPTURE") else {
        return;
    };

    if path.trim().is_empty() {
        return;
    }

    let path = PathBuf::from(path);

    /* The recording is source code, so it has to be named like source code. A
    path with any other extension would be written all the same, and the test
    that imports the module would go on reporting that it does not exist,
    which is a long way to travel to learn that a variable was stale. */
    assert!(
        path.extension().is_some_and(|extension| extension == "ts"),
        "POIETICA_ACP_CAPTURE must name a .ts module; got {}",
        path.display()
    );

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("the capture directory");
    }

    let body = serde_json::to_string_pretty(events).expect("the frames to serialise");

    let module = format!(
        "// Generated by agent/runtime/native/tests/live_turn.rs. Do not edit.\n\
         //\n\
         // One real turn, recorded verbatim. If a frame here fails validation the\n\
         // validator is wrong, not the recording. Regenerate with:\n\
         //\n\
         //   cargo test -p poietica-agent-runtime-native --test live_turn -- --ignored\n\
         \n\
         export interface RecordedFrame {{\n\
         \u{20}\u{20}readonly runId: string\n\
         \u{20}\u{20}readonly seq: number\n\
         \u{20}\u{20}readonly kind: string\n\
         \u{20}\u{20}readonly frame: unknown\n\
         }}\n\
         \n\
         export const recordedTurn: readonly RecordedFrame[] = {body}\n"
    );

    std::fs::write(&path, module).expect("the capture to be written");

    println!("captured {} frames to {}", events.len(), path.display());
}
