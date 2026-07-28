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

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use poietica_ai_acp_native::{
    AcpError, AgentClient, AgentConnection, AgentSpawn, ConfigControl, ConfigPurpose,
    PermissionDesk, RecordedEvent, Recorder, RunSlot, connect,
};
use poietica_ai_persistence_native::{AiStore, StoreError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, async_runtime};
use uuid::Uuid;

use crate::error::{Error, IpcError, Result};

type AgentCommandResult<T> = std::result::Result<T, IpcError>;

/// The event the renderer listens on to receive run frames.
pub const AGENT_EVENT: &str = "ai-run-event";

/// The encrypted database, kept beside the rest of the application data.
const DATABASE_FILE: &str = "ai.sqlite3";

/// The agent started when the caller does not name one.
const DEFAULT_AGENT_COMMAND: &str = "kimi acp";

/// What Windows falls back to when PATHEXT is not set.
#[cfg(windows)]
const DEFAULT_PATHEXT: &str = ".COM;.EXE;.BAT;.CMD";

/// How much of the first message stands in as a conversation name.
const TITLE_CHARS: usize = 60;

const NO_SESSION: &str = "no agent session is running";
const POISONED: &str = "the agent session lock was left locked by a panicking task";
const NO_SESSION_ID: &str = "the agent closed the connection before creating a session";
const NO_ANSWER: &str = "the agent session ended before answering";

/// The live session, if one has been started.
#[derive(Debug)]
#[allow(
    clippy::struct_field_names,
    reason = "session_id is the ACP wire field name; renaming it would hide the protocol contract"
)]
struct Session {
    client: AgentClient,
    session_id: String,
    thread_id: Uuid,
}

/// Managed state for everything the agent commands need.
#[derive(Debug)]
pub struct AgentRuntime {
    database: PathBuf,
    root: PathBuf,
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
    /// Fails when the data directory or the home directory cannot be resolved,
    /// or when the data directory cannot be created.
    pub fn new<R: Runtime>(handle: &AppHandle<R>) -> Result<Self> {
        let directory = handle.path().app_data_dir()?;
        std::fs::create_dir_all(&directory)?;

        // The session root is resolved here, once, from the platform rather than
        // from the process. A development run starts the binary inside src-tauri,
        // so the process directory is a build location and never a place the user
        // keeps work.
        let root = handle.path().home_dir()?;

        Ok(Self {
            database: directory.join(DATABASE_FILE),
            root,
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
    /// The conversation this turn belongs to, when the interface names one.
    pub thread_id: Option<String>,
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

    // The turn is recorded under the conversation on screen. The interface
    // names it, because the interface is what the user is looking at; a
    // request naming none is a surface that has not opened one yet, which is
    // still the session's own conversation.
    let thread_id = match request.thread_id.as_deref().map(Uuid::parse_str) {
        Some(Ok(named)) => named,
        _unnamed => session.thread_id,
    };

    // 对话持有的那条会话，才是这一轮该发去的地方。这个映射
    // attach_session 早就写进库里了，只是从来没有人查过它，所以第二
    // 条对话的提问全部发进了连接的第一条会话。
    //
    // 查不到的对话是这条连接自己的对话，仍然回落到它的会话上——那也
    // 正是上面那个分支已经在说的话。
    let addressed = store
        .session_for_thread(thread_id)
        .map_err(persistence)?
        .unwrap_or_else(|| session.session_id.clone());

    let run_id = store.start_run(thread_id).map_err(persistence)?;

    // The first thing said names the conversation. It is a stand in and is
    // recorded as one, so the agent's own title still replaces it later, and a
    // conversation in the list reads as what was asked in it.
    let opener: String = text.chars().take(TITLE_CHARS).collect();

    store
        .name_from_message(thread_id, &opener)
        .map_err(persistence)?;

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

    let answer = session
        .client
        .prompt(addressed.clone(), text, recorder)
        .map_err(translate)?;

    async_runtime::spawn(async move {
        match answer.await {
            // A turn that ends without a word looks, from the outside, exactly
            // like a turn that never reached the agent. The stop reason is the
            // account the agent gave, so it is written down even when nothing
            // went wrong.
            Ok(Ok(stop_reason)) => log::info!("the agent turn stopped: {stop_reason:?}"),
            // Both of these were already recorded as a run_failed frame; the
            // log entry here is for the developer, not for the interface.
            Ok(Err(error)) => log::error!("the agent turn failed: {error}"),
            Err(_dropped) => log::warn!("the agent turn ended without an answer"),
        }
    });

    Ok(AgentPromptResult {
        run_id: run_id.to_string(),
        session_id: addressed,
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

/// A request to replay a whole conversation from the log.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoadThreadRequest {
    /// The conversation to read.
    pub thread_id: String,
}

/// A conversation as it was recorded.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentThreadTranscript {
    /// The conversation the frames belong to.
    pub thread_id: String,
    /// Every frame of every turn, in the order they happened.
    pub events: Vec<Value>,
}

/// Reads a whole conversation back out of the log.
///
/// Opening a conversation is reading one, so this is what the interface calls
/// when the user picks one: the frames are the same values that were broadcast
/// while each turn was live, which is why a conversation reopened cannot drift
/// from having watched it happen.
///
/// A conversation the log has never seen has no frames. That is an empty
/// transcript rather than a failure, which is what a conversation nobody has
/// spoken in yet actually is.
///
/// # Errors
///
/// Fails when the log cannot be opened or read.
#[tauri::command]
#[specta::specta]
pub fn agent_load_thread(
    state: State<'_, AgentRuntime>,
    request: AgentLoadThreadRequest,
) -> AgentCommandResult<AgentThreadTranscript> {
    let Ok(thread_id) = Uuid::parse_str(&request.thread_id) else {
        return Ok(AgentThreadTranscript {
            thread_id: request.thread_id,
            events: Vec::new(),
        });
    };

    let store = AiStore::open(&state.database).map_err(persistence)?;
    let events = store.thread_events(thread_id).map_err(persistence)?;

    Ok(AgentThreadTranscript {
        thread_id: request.thread_id,
        events: events.into_iter().map(|event| event.payload).collect(),
    })
}

/// What a session selector is for.
///
/// These are the categories the protocol defines. A category the agent
/// invents beyond them arrives as other and is still shown.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AgentConfigPurpose {
    /// How much freedom the agent takes during a turn.
    Mode,
    /// Which model answers.
    Model,
    /// How long the model deliberates before answering.
    Thought,
    /// Something the agent named itself.
    Other,
}

/// One value a selector will accept.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigChoice {
    /// The value sent back when this one is picked.
    pub value: String,
    /// The name the agent gave it.
    pub label: String,
    /// The explanation the agent gave, where it gave one.
    pub detail: Option<String>,
}

/// One selector the running session offers.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigControl {
    /// The identifier the agent answers to when the value is changed.
    pub id: String,
    /// The name the agent gave this selector.
    pub label: String,
    /// The explanation the agent gave, where it gave one.
    pub detail: Option<String>,
    /// Where this selector belongs on screen.
    pub purpose: AgentConfigPurpose,
    /// The value in force right now.
    pub current: String,
    /// Every value on offer.
    pub choices: Vec<AgentConfigChoice>,
}

/// A change made in the interface.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSelectConfigRequest {
    /// One of the selector identifiers the session reported.
    pub config_id: String,
    /// One of the values that selector offered.
    pub value: String,
}

/// Lists the selectors the running session offers.
///
/// The agent reports these when the session is created, so an empty list
/// means no session is running yet rather than a session without choices.
/// Nothing is invented here: a model, a reasoning level or a mode appears
/// in this list only because the agent named it.
///
/// # Errors
///
/// Fails when the session lock was poisoned or the driver has stopped.
#[tauri::command]
#[specta::specta]
pub async fn agent_config_options(
    state: State<'_, AgentRuntime>,
) -> AgentCommandResult<Vec<AgentConfigControl>> {
    // A selector belongs to a session, so asking what is on offer is what
    // starts one. The alternative was to answer with nothing until the
    // first prompt, which left the interface showing a model read from a
    // file that the session, once it existed, might not be following.
    //
    // Opening this surface is the user opening the feature, which is not
    // the same as paying for it at launch: nothing here runs until the
    // interface asks.
    let live = ensure_session(&state, None, None).await?;

    let answer = live
        .client
        .selectors(live.session_id.clone())
        .map_err(translate)?;
    let offered = answer
        .await
        .map_err(|_dropped| Error::Internal(NO_ANSWER.to_owned()))?
        .map_err(translate)?;

    Ok(offered.into_iter().map(restate).collect())
}

/// Changes one selector on the running session.
///
/// The change applies to the session in flight, so nothing is restarted
/// and nothing is written to the agent configuration file. The answer is
/// the whole list as the agent reports it afterwards, because one change
/// may add or remove another selector.
///
/// # Errors
///
/// Fails when no session is running, when a turn is in flight, or when
/// the agent refuses the value.
#[tauri::command]
#[specta::specta]
pub async fn agent_set_config_option(
    state: State<'_, AgentRuntime>,
    request: AgentSelectConfigRequest,
) -> AgentCommandResult<Vec<AgentConfigControl>> {
    let live = borrow(&state)?.ok_or_else(|| Error::NotFound(NO_SESSION.to_owned()))?;

    let answer = live
        .client
        .select(live.session_id.clone(), request.config_id, request.value)
        .map_err(translate)?;
    let offered = answer
        .await
        .map_err(|_dropped| Error::Internal(NO_ANSWER.to_owned()))?
        .map_err(translate)?;

    Ok(offered.into_iter().map(restate).collect())
}

/// Restates one selector in the shape the generated bindings carry.
fn restate(control: ConfigControl) -> AgentConfigControl {
    AgentConfigControl {
        id: control.id,
        label: control.label,
        detail: control.detail,
        purpose: match control.purpose {
            ConfigPurpose::Mode => AgentConfigPurpose::Mode,
            ConfigPurpose::Model => AgentConfigPurpose::Model,
            ConfigPurpose::Thought => AgentConfigPurpose::Thought,
            ConfigPurpose::Other => AgentConfigPurpose::Other,
        },
        current: control.current,
        choices: control
            .choices
            .into_iter()
            .map(|choice| AgentConfigChoice {
                value: choice.value,
                label: choice.label,
                detail: choice.detail,
            })
            .collect(),
    }
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

    // The agent reads and writes relative to the directory the session was
    // created against, so the fallback has to be somewhere the user actually
    // keeps files. Asking the process where it is answers a different
    // question: under a development run that is the Rust build directory.
    let working_directory = match cwd {
        Some(path) => PathBuf::from(path),
        None => state.root.clone(),
    };

    let spawn = AgentSpawn {
        command: resolve_command(command),
        cwd: working_directory,
    };

    // The book that files frames under the session that names them belongs
    // to the connection, and the driver holds its own handle to it, so
    // routing works while this side leaves it alone. The runtime takes it
    // over once it keeps more than one session at a time.
    let AgentConnection {
        client,
        session_id,
        driver,
        book: _,
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
    let thread_id = store
        .create_thread(FALLBACK_THREAD_TITLE)
        .map_err(persistence)?;

    // 第一条会话也是被某条对话持有的。记下来，寻址就只剩一条规则：
    // 对话 → 会话。此前主会话不 attach，它的 session_id 是 NULL，
    // 于是它成了唯一一个要靠别的办法才能找到的会话。
    store
        .attach_session(thread_id, &session_id)
        .map_err(persistence)?;

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
/// Nothing outside the program gets a vote. An environment variable would make
/// this work on the machine that happens to define it and fail on every other
/// one, so the caller's choice wins and the built-in default is the only
/// fallback. Making that name launchable is a separate question, answered by
/// resolution rather than by configuration.
fn resolve_command(requested: Option<String>) -> String {
    let line = requested.unwrap_or_else(|| DEFAULT_AGENT_COMMAND.to_owned());

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
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_missing| DEFAULT_PATHEXT.to_owned());
    let path = std::env::var_os("PATH")?;

    for directory in std::env::split_paths(&path) {
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

/// Where a new session should be opened, and how to start the agent if it
/// is not running yet.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentNewSessionRequest {
    /// The agent command line; defaults to the Kimi ACP entry point.
    pub command: Option<String>,
    /// The working directory the session is created against.
    pub cwd: Option<String>,
}

/// A session the agent just opened, and what it offers for that session.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentOpenedSession {
    /// The name every frame of this session carries.
    pub session_id: String,
    /// What may be chosen for this session, as the agent reported it.
    pub selectors: Vec<AgentConfigControl>,
}

/// One line of the agent's own session list.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    /// The session this line describes.
    pub session_id: String,
    /// The title the agent gave it, if it has given one yet.
    pub title: Option<String>,
    /// When the agent last saw activity on it, as it reported it.
    pub updated_at: Option<String>,
}

/// Opens one more session on the running agent.
///
/// One agent process keeps many sessions, and every frame the agent sends
/// names the session it belongs to, so a second session is a second
/// conversation rather than a second process. The selectors come back with
/// it because they belong to the session, not to the connection: what one
/// session has chosen as its model or reasoning level says nothing about
/// what another has chosen.
///
/// # Errors
///
/// Fails when the agent cannot be started, when a turn is in flight on the
/// connection, or when the agent refuses to open a session.
#[tauri::command]
#[specta::specta]
pub async fn agent_new_session(
    state: State<'_, AgentRuntime>,
    request: AgentNewSessionRequest,
) -> AgentCommandResult<AgentOpenedSession> {
    let asked = request.cwd.clone();
    let live = ensure_session(&state, request.command, request.cwd).await?;

    // The session root is the platform's answer, not the process's, so a
    // caller that names no directory gets the same one the first session
    // was created against.
    let working_directory = match asked {
        Some(given) => PathBuf::from(given),
        None => state.root.clone(),
    };

    let opened = live
        .client
        .new_session(working_directory)
        .await
        .map_err(translate)?;

    Ok(AgentOpenedSession {
        session_id: opened.session_id,
        selectors: opened.selectors.into_iter().map(restate).collect(),
    })
}

/// Lists the sessions the agent itself keeps.
///
/// The title is the agent's own, which is the only honest source for one;
/// a session it has not named yet reports none, and what to show in that
/// case is a question for the interface, not for this command.
///
/// # Errors
///
/// Fails when no session is running, when a turn is in flight, or when the
/// agent refuses to list its sessions.
#[tauri::command]
#[specta::specta]
pub async fn agent_sessions(
    state: State<'_, AgentRuntime>,
) -> AgentCommandResult<Vec<AgentSessionSummary>> {
    let live = borrow(&state)?.ok_or_else(|| Error::NotFound(NO_SESSION.to_owned()))?;

    let listed = live.client.sessions().await.map_err(translate)?;

    Ok(listed
        .into_iter()
        .map(|info| AgentSessionSummary {
            session_id: info.session_id,
            title: info.title,
            updated_at: info.updated_at,
        })
        .collect())
}

/// The name a conversation carries before anything has named it.
const FALLBACK_THREAD_TITLE: &str = "新建对话";

/// Reported when a thread was written but could not be read back.
const NO_THREAD: &str = "the conversation was created but could not be read back";

/// One conversation, as a list of conversations and a tab strip need it.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentThread {
    /// The stored conversation.
    pub thread_id: String,
    /// The agent session it is holding, where it holds one.
    pub session_id: Option<String>,
    /// The name to show for it.
    pub title: String,
    /// Where that name came from: official, message or fallback.
    pub title_source: String,
    /// When it was last touched, in RFC 3339.
    pub updated_at: String,
    /// Whether it is held at the top of the list.
    pub pinned: bool,
}

/// A conversation that was just opened, and what its session offers.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentOpenedThread {
    /// The conversation itself.
    pub thread: AgentThread,
    /// What may be chosen for this session, as the agent reported it.
    pub selectors: Vec<AgentConfigControl>,
}

/// Lists the stored conversations, newest first.
///
/// Official names are the agent's own, so they are folded in first when
/// the connection can answer. A refusal there is not a failure of this
/// command: while a turn is in flight the agent will not list its
/// sessions, and the right answer then is the names already stored, not
/// an error where a list of conversations belongs.
///
/// # Errors
///
/// Fails when the database cannot be opened or read.
#[tauri::command]
#[specta::specta]
pub async fn agent_threads(state: State<'_, AgentRuntime>) -> AgentCommandResult<Vec<AgentThread>> {
    let store =
        AiStore::open(&state.database).map_err(|failure| Error::Internal(failure.to_string()))?;

    if let Ok(Some(live)) = borrow(&state)
        && let Ok(listed) = live.client.sessions().await
    {
        for info in listed {
            let Some(title) = info.title else { continue };
            let Ok(Some(thread)) = store.thread_for_session(&info.session_id) else {
                continue;
            };
            let Ok(id) = Uuid::parse_str(&thread) else {
                continue;
            };

            let official = poietica_ai_persistence_native::TitleSource::Official;

            store
                .rename_thread(id, &title, official)
                .map_err(|failure| Error::Internal(failure.to_string()))?;
        }
    }

    let stored = store
        .list_threads()
        .map_err(|failure| Error::Internal(failure.to_string()))?;

    Ok(stored.into_iter().map(retitle).collect())
}

/// Opens one more conversation: a session on the agent, and a row holding
/// it.
///
/// The conversation is stored before it has a name, because a name is
/// something that arrives later: the agent's own title if it sends one,
/// otherwise whatever the interface can stand in with. Both are recorded
/// as what they are, so a stand in never replaces a real name.
///
/// # Errors
///
/// Fails when the agent cannot be started, when a turn is in flight on
/// the connection, or when the database rejects the write.
#[tauri::command]
#[specta::specta]
pub async fn agent_open_thread(
    state: State<'_, AgentRuntime>,
    request: AgentNewSessionRequest,
) -> AgentCommandResult<AgentOpenedThread> {
    let asked = request.cwd.clone();
    let live = ensure_session(&state, request.command, request.cwd).await?;

    let working_directory = match asked {
        Some(given) => PathBuf::from(given),
        None => state.root.clone(),
    };

    let opened = live
        .client
        .new_session(working_directory)
        .await
        .map_err(translate)?;

    let store =
        AiStore::open(&state.database).map_err(|failure| Error::Internal(failure.to_string()))?;

    let thread_id = store
        .create_thread(FALLBACK_THREAD_TITLE)
        .map_err(|failure| Error::Internal(failure.to_string()))?;

    store
        .attach_session(thread_id, &opened.session_id)
        .map_err(|failure| Error::Internal(failure.to_string()))?;

    // list_threads 有意漏掉没有任何一轮的对话——一份对话清单列的是
    // 发生过的对话。刚刚创建的这一条正是那样一条，所以到那份清单里
    // 去找它，等于每一次开对话都返回「创建了却读不回来」。
    let thread = store
        .thread(thread_id)
        .map_err(|failure| Error::Internal(failure.to_string()))?
        .map(retitle)
        .ok_or_else(|| Error::Internal(NO_THREAD.to_owned()))?;

    Ok(AgentOpenedThread {
        thread,
        selectors: opened.selectors.into_iter().map(restate).collect(),
    })
}

/// Restates one stored conversation in the shape the bindings carry.
fn retitle(thread: poietica_ai_persistence_native::ThreadSummary) -> AgentThread {
    AgentThread {
        thread_id: thread.id,
        session_id: thread.session_id,
        title: thread.title,
        title_source: thread.title_source,
        updated_at: thread.updated_at,
        pinned: thread.pinned,
    }
}

/// A conversation the interface is renaming.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentRenameThreadRequest {
    /// The conversation being renamed.
    pub thread_id: String,
    /// The name the user typed.
    pub title: String,
}

/// A conversation an action applies to, and nothing else.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentThreadRequest {
    /// The conversation the action applies to.
    pub thread_id: String,
}

/// A conversation being held at the top of the list, or released.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentPinThreadRequest {
    /// The conversation the action applies to.
    pub thread_id: String,
    /// Whether it should be held at the top.
    pub pinned: bool,
}

/// Reads a conversation identifier the renderer supplied.
fn conversation(named: &str) -> Result<Uuid> {
    Uuid::parse_str(named).map_err(|_invalid| {
        Error::Validation("the conversation identifier is not a UUID".to_owned())
    })
}

/// Renames a conversation.
///
/// The name is recorded as the user's, and the agent's own title no longer
/// replaces it: that question has already been answered by the person who
/// typed it.
///
/// # Errors
///
/// Fails when the identifier is not a UUID, the name is empty, or the
/// database rejects the write.
#[tauri::command]
#[specta::specta]
pub fn agent_rename_thread(
    state: State<'_, AgentRuntime>,
    request: AgentRenameThreadRequest,
) -> AgentCommandResult<()> {
    let title: String = request.title.trim().chars().take(TITLE_CHARS).collect();

    if title.is_empty() {
        return Err(Error::Validation("the conversation name is empty".to_owned()).into());
    }

    let id = conversation(&request.thread_id)?;
    let store = AiStore::open(&state.database).map_err(persistence)?;

    store.name_by_user(id, &title).map_err(persistence)?;

    Ok(())
}

/// Deletes a conversation and every frame recorded under it.
///
/// # Errors
///
/// Fails when the identifier is not a UUID or the database rejects the
/// deletes.
#[tauri::command]
#[specta::specta]
pub fn agent_delete_thread(
    state: State<'_, AgentRuntime>,
    request: AgentThreadRequest,
) -> AgentCommandResult<()> {
    let id = conversation(&request.thread_id)?;
    let store = AiStore::open(&state.database).map_err(persistence)?;

    store.delete_thread(id).map_err(persistence)?;

    Ok(())
}

/// Holds a conversation at the top of the list, or releases it.
///
/// # Errors
///
/// Fails when the identifier is not a UUID or the database rejects the
/// write.
#[tauri::command]
#[specta::specta]
pub fn agent_pin_thread(
    state: State<'_, AgentRuntime>,
    request: AgentPinThreadRequest,
) -> AgentCommandResult<()> {
    let id = conversation(&request.thread_id)?;
    let store = AiStore::open(&state.database).map_err(persistence)?;

    store.set_pinned(id, request.pinned).map_err(persistence)?;

    Ok(())
}
