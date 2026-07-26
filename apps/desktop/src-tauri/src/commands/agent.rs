//! The desktop seam onto the ACP client.
//!
//! Three rules shape this module.
//!
//! The session is started once and reused. A turn is cheap; a process and a
//! protocol handshake are not, and a session that restarted between turns
//! would throw away the context the agent has built up.
//!
//! The renderer is never the source of truth. Every frame it receives has
//! already been written to the encrypted log, so a dropped event is a
//! reload away from being recovered through `agent_load_run` rather than
//! lost.
//!
//! An answer arriving from the renderer is untrusted. The desk checks it
//! against the options the agent actually offered before anything is recorded
//! or sent.

use std::env;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use poietica_ai_acp_native::{
    connect, AcpError, AgentClient, AgentConnection, AgentSpawn, PermissionDesk, RecordedEvent,
    Recorder, RunSlot,
};
use poietica_ai_persistence_native::{AiStore, StoreError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use tauri::{async_runtime, AppHandle, Emitter, Manager, Runtime, State};
use uuid::Uuid;

use crate::error::{Error, IpcError, Result};

type AgentCommandResult<T> = std::result::Result<T, IpcError>;

/// The event the renderer listens on to receive run frames.
pub const AGENT_EVENT: &str = "ai-run-event";

/// The encrypted database, kept beside the rest of the application data.
const DATABASE_FILE: &str = "ai.sqlite3";

/// The agent started when the caller does not name one.
const DEFAULT_AGENT_COMMAND: &str = "kimi acp";

/// Overrides the agent command line without a rebuild.
///
/// The live-turn test already reads this name, so the application and the test
/// choose an agent the same way.
const COMMAND_ENV: &str = "POIETICA_ACP_COMMAND";

/// What Windows falls back to when PATHEXT is not set.
#[cfg(windows)]
const DEFAULT_PATHEXT: &str = ".COM;.EXE;.BAT;.CMD";

/// Threads are named by the interface later; this is only a placeholder.
const THREAD_TITLE: &str = "session";

const NO_SESSION: &str = "no agent session is running";
const POISONED: &str = "the agent session lock was left locked by a panicking task";
const NO_SESSION_ID: &str = "the agent closed the connection before creating a session";

/// The live session, if one has been started.
#[derive(Debug)]
struct Session {
    client: AgentClient,
    session_id: String,
    thread_id: Uuid,
}

/// Managed state for everything the agent commands need.
#[derive(Debug)]
pub struct AgentRuntime {
    database: PathBuf,
    slot: RunSlot,
    desk: PermissionDesk,
    session: Mutex<Option<Session>>,
}

impl AgentRuntime {
    /// Prepares the runtime without starting anything.
    ///
    /// Starting the agent process at boot would make every launch pay for a
    /// feature the user may never open, so the process is spawned on the
    /// first prompt instead.
    ///
    /// # Errors
    ///
    /// Fails when the application data directory cannot be resolved or created.
    pub fn new<R: Runtime>(handle: &AppHandle<R>) -> Result<Self> {
        let directory = handle.path().app_data_dir()?;
        std::fs::create_dir_all(&directory)?;

        Ok(Self {
            database: directory.join(DATABASE_FILE),
            slot: RunSlot::new(),
            desk: PermissionDesk::new(),
            session: Mutex::new(None),
        })
    }
}

/// A prompt, and how to start the agent if it is not running yet.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptRequest {
    /// What the user typed.
    pub text: String,
    /// The agent command line; defaults to the Kimi ACP entry point.
    pub command: Option<String>,
    /// The working directory the session is created against.
    pub cwd: Option<String>,
}

/// What the interface needs to follow the turn it just started.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptResult {
    /// The run every frame of this turn is tagged with.
    pub run_id: String,
    /// The session the run belongs to.
    pub session_id: String,
}

/// A user's answer to a permission request.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentResolvePermissionRequest {
    /// The request being answered.
    pub request_id: String,
    /// One of the options the agent offered with that request.
    pub option_id: String,
}

/// A request to replay a run from the log.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoadRunRequest {
    /// The run to read.
    pub run_id: String,
    /// Resume after this position; omit to read from the beginning.
    ///
    /// The width is deliberate. Sequence numbers are 64-bit in the log, but
    /// the generated TypeScript refuses a 64-bit integer rather than hand the
    /// renderer a value it cannot represent, and no single run is going to
    /// reach four billion frames.
    pub after_seq: Option<u32>,
}

/// A run as it was recorded.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunSnapshot {
    /// The run the frames belong to.
    pub run_id: String,
    /// The frames, in order, exactly as they were broadcast when live.
    pub events: Vec<Value>,
}

/// Starts a turn and returns as soon as it is under way.
///
/// The answer to the prompt is not awaited here. Frames arrive on
/// [`AGENT_EVENT`] as they are recorded, which is what the timeline consumes;
/// blocking the caller until the agent stopped would defeat the point.
///
/// # Errors
///
/// Fails when the prompt is empty, the agent cannot be started, or the log
/// cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn agent_prompt(
    app: AppHandle,
    state: State<'_, AgentRuntime>,
    request: AgentPromptRequest,
) -> AgentCommandResult<AgentPromptResult> {
    let text = request.text.trim().to_owned();

    if text.is_empty() {
        return Err(Error::Validation("the prompt is empty".to_owned()).into());
    }

    let session = ensure_session(&state, request.command, request.cwd).await?;

    // Opening the store is a file open and a pragma, and the log is the one
    // thing that must exist before the turn does, so it is done inline rather
    // than handed to a thread whose failure would arrive after the fact.
    let store = AiStore::open(&state.database).map_err(persistence)?;
    let run_id = store.start_run(session.thread_id).map_err(persistence)?;

    let handle = app.clone();
    let recorder = Recorder::new(
        store,
        run_id,
        Box::new(move |event: &RecordedEvent| {
            // The frame is already durable. A renderer that is not listening
            // can replay the run, so a failed emit must not fail the turn.
            let _ignored = handle.emit(AGENT_EVENT, event);
        }),
    );

    let answer = session.client.prompt(text, recorder).map_err(translate)?;

    async_runtime::spawn(async move {
        match answer.await {
            Ok(Ok(_stop_reason)) => {}
            // Both of these were already recorded as a run_failed frame; the
            // log entry here is for the developer, not for the interface.
            Ok(Err(error)) => log::error!("the agent turn failed: {error}"),
            Err(_dropped) => log::warn!("the agent turn ended without an answer"),
        }
    });

    Ok(AgentPromptResult {
        run_id: run_id.to_string(),
        session_id: session.session_id,
    })
}

/// Answers a permission request the agent is blocked on.
///
/// # Errors
///
/// Fails when the request is not outstanding, when the option was never
/// offered, or when the agent has already stopped waiting.
#[tauri::command]
#[specta::specta]
pub fn agent_resolve_permission(
    state: State<'_, AgentRuntime>,
    request: AgentResolvePermissionRequest,
) -> AgentCommandResult<()> {
    // Every failure here means the same thing to the interface: that answer no
    // longer applies to anything. The detail stays on this side of the wire.
    state
        .desk
        .answer(&request.request_id, &request.option_id)
        .map_err(|error| Error::NotFound(error.to_string()))?;

    Ok(())
}

/// Asks the agent to stop the turn that is in flight.
///
/// Cancellation is cooperative: the agent may still finish normally, and the
/// recorded stop reason reports which of the two happened.
///
/// # Errors
///
/// Fails when no session is running or the driver has stopped.
#[tauri::command]
#[specta::specta]
pub fn agent_cancel(state: State<'_, AgentRuntime>) -> AgentCommandResult<()> {
    let guard = lock(&state.session)?;
    let live = guard
        .as_ref()
        .ok_or_else(|| Error::NotFound(NO_SESSION.to_owned()))?;

    live.client.cancel().map_err(translate)?;

    Ok(())
}

/// Ends the session and lets the agent process exit.
///
/// # Errors
///
/// Fails when the session lock was poisoned.
#[tauri::command]
#[specta::specta]
pub fn agent_shutdown(state: State<'_, AgentRuntime>) -> AgentCommandResult<()> {
    let taken = lock(&state.session)?.take();

    if let Some(live) = taken {
        // The process is going away either way, so a driver that already
        // stopped is not an error worth reporting.
        let _ignored = live.client.shutdown();
    }

    state.desk.clear();

    Ok(())
}

/// Reads a run back out of the log.
///
/// The frames returned are the same values that were broadcast while the run
/// was live, so replaying a stored run cannot drift from having watched it.
///
/// # Errors
///
/// Fails when the identifier is not a UUID or the log cannot be read.
#[tauri::command]
#[specta::specta]
pub fn agent_load_run(
    state: State<'_, AgentRuntime>,
    request: AgentLoadRunRequest,
) -> AgentCommandResult<AgentRunSnapshot> {
    let run_id = Uuid::parse_str(&request.run_id)
        .map_err(|_invalid| Error::Validation("the run identifier is not a UUID".to_owned()))?;

    let store = AiStore::open(&state.database).map_err(persistence)?;
    let events = store
        .events_since(run_id, i64::from(request.after_seq.unwrap_or_default()))
        .map_err(persistence)?;

    Ok(AgentRunSnapshot {
        run_id: request.run_id,
        events: events.into_iter().map(|event| event.payload).collect(),
    })
}

/// What a command needs to know about the running session.
struct Handle {
    client: AgentClient,
    session_id: String,
    thread_id: Uuid,
}

/// Returns the running session, starting one if there is none.
async fn ensure_session(
    state: &State<'_, AgentRuntime>,
    command: Option<String>,
    cwd: Option<String>,
) -> Result<Handle> {
    if let Some(live) = borrow(state)? {
        return Ok(live);
    }

    let working_directory = match cwd {
        Some(path) => PathBuf::from(path),
        None => env::current_dir()?,
    };

    let spawn = AgentSpawn {
        command: resolve_command(command),
        cwd: working_directory,
    };

    let AgentConnection {
        client,
        session_id,
        driver,
    } = connect(spawn, state.slot.clone(), state.desk.clone()).map_err(translate)?;

    // The crate is runtime-agnostic on purpose; this is the composition root,
    // so this is where the driver gets an executor.
    async_runtime::spawn(async move {
        if let Err(error) = driver.await {
            log::error!("the agent session ended: {error}");
        }
    });

    let session_id = session_id
        .await
        .map_err(|_dropped| Error::Internal(NO_SESSION_ID.to_owned()))?;

    let store = AiStore::open(&state.database).map_err(persistence)?;
    let thread_id = store.create_thread(THREAD_TITLE).map_err(persistence)?;

    let mut guard = lock(&state.session)?;

    // Two prompts can race to be the first. The loser hands its process back
    // rather than leaving an orphan behind.
    if let Some(live) = guard.as_ref() {
        let _ignored = client.shutdown();

        return Ok(Handle {
            client: live.client.clone(),
            session_id: live.session_id.clone(),
            thread_id: live.thread_id,
        });
    }

    *guard = Some(Session {
        client: client.clone(),
        session_id: session_id.clone(),
        thread_id,
    });

    Ok(Handle {
        client,
        session_id,
        thread_id,
    })
}

/// Reads the session without holding the lock across an await point.
fn borrow(state: &State<'_, AgentRuntime>) -> Result<Option<Handle>> {
    let guard = lock(&state.session)?;

    Ok(guard.as_ref().map(|live| Handle {
        client: live.client.clone(),
        session_id: live.session_id.clone(),
        thread_id: live.thread_id,
    }))
}

fn lock(session: &Mutex<Option<Session>>) -> Result<MutexGuard<'_, Option<Session>>> {
    session
        .lock()
        .map_err(|_poisoned| Error::Internal(POISONED.to_owned()))
}

/// Decides which command line starts the agent.
///
/// An explicit request wins, then the environment, then the built-in default.
fn resolve_command(requested: Option<String>) -> String {
    let line = requested
        .or_else(|| env::var(COMMAND_ENV).ok())
        .unwrap_or_else(|| DEFAULT_AGENT_COMMAND.to_owned());

    executable(&line)
}

/// Names the program in a way the operating system can actually launch.
///
/// A session is a spawned process, not a shell command, so nothing expands a
/// bare name on our behalf. On Windows the agent is usually a package-manager
/// shim named kimi.CMD, and spawning kimi fails outright, so the extension is
/// resolved here instead of being left for the user to discover.
#[cfg(windows)]
fn executable(line: &str) -> String {
    let (program, rest) = match line.find(char::is_whitespace) {
        Some(index) => line.split_at(index),
        None => (line, ""),
    };

    if std::path::Path::new(program).extension().is_some() {
        return line.to_owned();
    }

    match on_path(program) {
        // The name is left alone when nothing matches, so the failure the user
        // reads still mentions what they actually asked for.
        None => line.to_owned(),
        Some(found) => format!("{found}{rest}"),
    }
}

#[cfg(not(windows))]
fn executable(line: &str) -> String {
    line.to_owned()
}

/// Finds the file name, extension included, that a bare program name resolves to.
#[cfg(windows)]
fn on_path(program: &str) -> Option<String> {
    let extensions = env::var("PATHEXT").unwrap_or_else(|_missing| DEFAULT_PATHEXT.to_owned());
    let path = env::var_os("PATH")?;

    for directory in env::split_paths(&path) {
        for extension in extensions.split(';').filter(|entry| !entry.is_empty()) {
            let candidate = directory.join(format!("{program}{extension}"));

            if candidate.is_file() {
                return candidate
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned());
            }
        }
    }

    None
}

fn persistence(error: StoreError) -> Error {
    Error::Persistence(error.to_string())
}

/// Folds an agent failure into the application's existing error surface.
///
/// No variant is added for the agent: the public message table is an
/// exhaustive match whose whole purpose is to stop native detail reaching the
/// webview, and a new arm there would be a new way to leak.
fn translate(error: AcpError) -> Error {
    match error {
        AcpError::Store(inner) => Error::Persistence(inner.to_string()),
        AcpError::Encoding(inner) => Error::SerdeJson(inner),
        AcpError::Spawn { message } | AcpError::Protocol { message } => Error::Internal(message),
        // The enum is non-exhaustive, so the wildcard arm is required.
        other => Error::Internal(other.to_string()),
    }
}
