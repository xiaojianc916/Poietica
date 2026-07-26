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
//! cargo test -p poietica-ai-acp-native --test live_turn -- --ignored --nocapture
//! ```
//!
//! It is configured by the environment rather than by anything committed here,
//! so no machine's paths end up in the repository:
//!
//! - `POIETICA_ACP_COMMAND`  the agent command line (default: `kimi acp`)
//! - `POIETICA_ACP_PROMPT`   what to ask (default: a one-word reply)
//! - `POIETICA_ACP_CWD`      the session's working directory (default: a temporary one)
//! - `POIETICA_ACP_TIMEOUT`  seconds before the turn is cancelled (default: 120)
//!
//! Every wait in here is two-sided. The channels the client hands back are
//! cancelled when the connection dies, and a cancelled channel says nothing
//! about why, so each wait that comes back empty asks the driver thread for the
//! actual failure before reporting anything.

#![allow(clippy::expect_used)]

use std::env;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use futures::channel::oneshot;
use futures::executor::block_on;
use poietica_ai_acp_native::{
    connect, AcpError, AgentConnection, AgentSpawn, PermissionDesk, RecordedEvent, Recorder,
    RunSlot, RUN_FINISHED, RUN_STARTED,
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

    let cwd = env::var("POIETICA_ACP_CWD")
        .map(PathBuf::from)
        .unwrap_or_else(|_unset| directory.path().to_path_buf());

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
        println!("  {:>3} {}", event.seq, event.kind);
    }

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
