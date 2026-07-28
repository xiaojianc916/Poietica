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
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use poietica_agent_runtime_native::{
    AcpError, AgentClient, AgentConnection, AgentSpawn, ConfigControl, ConfigPurpose,
    PermissionDesk, RecordedEvent, Recorder, RunSlot, connect,
};
use poietica_agent_persistence_native::{AiStore, StoreError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, async_runtime};
use uuid::Uuid;

use crate::commands::agent_log::SharedLog;
use crate::error::{Error, IpcError, Result};

type AgentCommandResult<T> = std::result::Result<T, IpcError>;

/// The event the renderer listens on to receive run frames.
pub const AGENT_EVENT: &str = "ai-run-event";

/// The encrypted database, kept beside the rest of the application data.
const DATABASE_FILE: &str = "ai.sqlite3";

/// Reported when nothing named an agent to start.
///
/// There is no built-in agent. Which ACP agent to launch is one entry in
/// the interface's registry, so this layer never spells one out: a default
/// here is how "any ACP agent" quietly became "Kimi, and Kimi only".
const NO_AGENT_NAMED: &str = "no ACP agent was named for this session";

/// What Windows falls back to when PATHEXT is not set.
#[cfg(windows)]
const DEFAULT_PATHEXT: &str = ".COM;.EXE;.BAT;.CMD";

/// How much of the first message stands in as a conversation name.
const TITLE_CHARS: usize = 60;

const NO_SESSION: &str = "no agent session is running";
const POISONED: &str = "the agent session lock was left locked by a panicking task";
const NO_SESSION_ID: &str = "the agent closed the connection before creating a session";
const NO_ANSWER: &str = "the agent session ended before answering";
const NO_THREAD_SESSION: &str = "that conversation is not holding an agent session";

/// The live session, if one has been started.
///
/// The connection's own session identifier is deliberately absent. Which
/// session a turn or a selector is addressed to is answered by the
/// conversation holding it, so a second copy kept in memory could only ever
/// disagree with the one in the log.
#[derive(Debug)]
struct Session {
    client: AgentClient,
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
    /// The one connection to the encrypted log, opened on first use.
    ///
    /// Every command used to open one of its own: a credential store
    /// read, a SQLCipher attach and a full migrate, all of it again for
    /// something as ordinary as refreshing the sidebar. The single writer
    /// the log claims to be had never actually existed.
    store: OnceLock<Arc<Mutex<AiStore>>>,
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
            store: OnceLock::new(),
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

    // 一条对话持有一个会话，这一轮就发往它。
    //
    // 此前的兜底是"查不到就用连接上的第一条会话"，于是在第二条对话里
    // 提问，带的是第一条的上下文与模型。命名的对话若还没有会话，就在
    // 这里为它开一个并记下来——这是 ACP 的会话模型，不是补丁。
    let (thread_id, addressed) =
        resolve_turn_target(&state, &session, request.thread_id.as_deref()).await?;

    // The log is the one thing that must exist before the turn does, so
    // it is taken here rather than handed to a thread whose failure would
    // arrive after the fact. Nothing awaits below this line, so holding the
    // lock to the end of the command keeps this future Send.
    let shared = shared_store(&state)?;
    let store = borrow_store(&shared)?;

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
        Box::new(SharedLog::new(Arc::clone(&shared))),
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

    let shared = shared_store(&state)?;
    let store = borrow_store(&shared)?;
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

    let shared = shared_store(&state)?;
    let store = borrow_store(&shared)?;
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

/// Which conversation's selectors are being read.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigOptionsRequest {
    /// The conversation asking, when the interface has opened one.
    pub thread_id: Option<String>,
}

/// A change made in the interface.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSelectConfigRequest {
    /// The conversation the change applies to.
    pub thread_id: Option<String>,
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
    request: AgentConfigOptionsRequest,
) -> AgentCommandResult<Vec<AgentConfigControl>> {
    // Reading a selector is a read.
    //
    // It used to start the agent process, so rendering a toolbar spawned a
    // subprocess, ran a handshake and wrote a conversation row. Every way
    // that can fail — no agent installed, not on PATH, a slow handshake —
    // arrived as a failure banner on a surface the user had not used yet,
    // and every way it can succeed left behind a conversation nobody had.
    //
    // No session running means nothing to offer. The protocol says an empty
    // list is a legitimate answer, and this is what it is for.
    let Some(live) = borrow(&state)? else {
        return Ok(Vec::new());
    };

    // Selectors belong to a session, and a session is held by a
    // conversation. The crate has kept a set per session for some time, but
    // nothing said which set was wanted, so the answer was always the first
    // session on the connection: the model shown in the second conversation
    // was the one chosen in the first.
    //
    // The lock is taken and returned inside this block. Holding it across
    // the await below would make this future not Send.
    let addressed = {
        let shared = shared_store(&state)?;
        let store = borrow_store(&shared)?;

        session_held_by(&store, request.thread_id.as_deref(), &live)?
    };

    let Some(addressed) = addressed else {
        // 这条对话还没有握着任何会话：没有可读的选择器，这不是失败。
        return Ok(Vec::new());
    };

    let answer = live.client.selectors(addressed).map_err(translate)?;
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

    let addressed = {
        let shared = shared_store(&state)?;
        let store = borrow_store(&shared)?;

        session_held_by(&store, request.thread_id.as_deref(), &live)?
    };

    let addressed = addressed.ok_or_else(|| Error::NotFound(NO_THREAD_SESSION.to_owned()))?;

    let answer = live
        .client
        .select(addressed, request.config_id, request.value)
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
///
/// A connection to speak over, and the conversation that opened it. Addressing
/// is done by reading the log: session_held_by for a selector,
/// resolve_turn_target for a turn. A session identifier carried alongside them
/// is precisely what the discarded fallback used, which is why it is gone.
struct Handle {
    client: AgentClient,
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
        command: resolve_command(command)?,
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

    let shared = shared_store(state)?;
    let store = borrow_store(&shared)?;
    let thread_id = store
        .create_thread(FALLBACK_THREAD_TITLE)
        .map_err(persistence)?;

    // The first session is held by a conversation like any other. Writing
    // that down leaves one rule for addressing: conversation to session.
    // The primary session used not to be attached, so its session_id was
    // NULL and it became the one session that had to be found some other
    // way.
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
            thread_id: live.thread_id,
        });
    }

    *guard = Some(Session {
        client: client.clone(),
        thread_id,
    });

    Ok(Handle { client, thread_id })
}

/// Reads the session without holding the lock across an await point.
fn borrow(state: &State<'_, AgentRuntime>) -> Result<Option<Handle>> {
    let guard = lock(&state.session)?;

    Ok(guard.as_ref().map(|live| Handle {
        client: live.client.clone(),
        thread_id: live.thread_id,
    }))
}

/// The one connection, opened the first time anything needs it.
///
/// Not at boot: opening it reads the operating system credential store, and
/// a launch that never opens the assistant should not pay for that. Once,
/// though, and not once per command.
fn shared_store(state: &State<'_, AgentRuntime>) -> Result<Arc<Mutex<AiStore>>> {
    if let Some(held) = state.store.get() {
        return Ok(Arc::clone(held));
    }

    let opened = Arc::new(Mutex::new(
        AiStore::open(&state.database).map_err(persistence)?,
    ));

    // Two commands can race to be the first. The loser's connection is
    // dropped and everyone uses the winner's, which is the whole point.
    Ok(Arc::clone(state.store.get_or_init(|| opened)))
}

/// Takes the connection for the length of one statement.
///
/// Never held across an await: a guard that is would make the command's
/// future not Send, which is why this is a separate step from taking the
/// share above rather than one call that does both.
fn borrow_store(shared: &Arc<Mutex<AiStore>>) -> Result<MutexGuard<'_, AiStore>> {
    shared
        .lock()
        .map_err(|_poisoned| Error::Internal(POISONED.to_owned()))
}

fn lock(session: &Mutex<Option<Session>>) -> Result<MutexGuard<'_, Option<Session>>> {
    session
        .lock()
        .map_err(|_poisoned| Error::Internal(POISONED.to_owned()))
}

/// Decides which command line starts the agent.
///
/// Nothing outside the program gets a vote, and nothing inside it has a
/// favourite: the caller names the agent or no session is started. Making
/// that name launchable is a separate question, answered by resolution
/// rather than by configuration.
fn resolve_command(requested: Option<String>) -> Result<String> {
    let line = requested.ok_or_else(|| Error::Validation(NO_AGENT_NAMED.to_owned()))?;

    Ok(executable(&line))
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
        AcpError::Log(inner) => Error::Persistence(inner.to_string()),
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
    let shared = shared_store(&state)?;

    // Ask the agent first, take the lock second: a guard held across the
    // await would make this future not Send.
    let official = match borrow(&state) {
        Ok(Some(live)) => live.client.sessions().await.ok(),
        _unavailable => None,
    };

    let store = borrow_store(&shared)?;

    if let Some(listed) = official {
        for info in listed {
            let Some(title) = info.title else { continue };
            let Ok(Some(thread)) = store.thread_for_session(&info.session_id) else {
                continue;
            };
            let Ok(id) = Uuid::parse_str(&thread) else {
                continue;
            };

            let official = poietica_agent_persistence_native::TitleSource::Official;

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

    let shared = shared_store(&state)?;
    let store = borrow_store(&shared)?;

    let thread_id = store
        .create_thread(FALLBACK_THREAD_TITLE)
        .map_err(|failure| Error::Internal(failure.to_string()))?;

    store
        .attach_session(thread_id, &opened.session_id)
        .map_err(|failure| Error::Internal(failure.to_string()))?;

    // list_threads leaves out conversations that have had no turns, on
    // purpose: a list of conversations lists ones that happened. The row
    // just created is exactly such a conversation, so looking for it in that
    // list meant every newly opened conversation reported itself as created
    // but unreadable.
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
fn retitle(thread: poietica_agent_persistence_native::ThreadSummary) -> AgentThread {
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

/// The conversation a request names, or the one this connection is on.
///
/// An identifier that is not a UUID is a mistake on the calling side. It
/// used to be swallowed, which meant a malformed name silently addressed
/// somebody else's conversation.
fn conversation_or(named: Option<&str>, held: Uuid) -> Result<Uuid> {
    match named {
        None => Ok(held),
        Some(text) => conversation(text),
    }
}

/// The session a conversation is holding, and nothing else.
///
/// One rule for addressing, with no fallback: a conversation holds a
/// session, attach_session is where that was written down, and a
/// conversation holding none holds none. Falling back to "the session this
/// connection happens to be on" is how a model chosen in one conversation
/// took effect in another.
fn session_held_by(
    store: &AiStore,
    named: Option<&str>,
    live: &Handle,
) -> Result<Option<String>> {
    let thread_id = conversation_or(named, live.thread_id)?;

    store.session_for_thread(thread_id).map_err(persistence)
}

/// The conversation this turn belongs to, and the session it is sent to.
///
/// A named conversation holding no session gets one opened for it here: in
/// ACP terms a conversation *is* a session, so this is where the two are
/// tied together rather than papered over at every call site. Nothing is
/// awaited while a lock is held, so this stays Send.
async fn resolve_turn_target(
    state: &State<'_, AgentRuntime>,
    live: &Handle,
    named: Option<&str>,
) -> Result<(Uuid, String)> {
    let thread_id = conversation_or(named, live.thread_id)?;

    let held = {
        let shared = shared_store(state)?;
        let store = borrow_store(&shared)?;

        store.session_for_thread(thread_id).map_err(persistence)?
    };

    if let Some(session_id) = held {
        return Ok((thread_id, session_id));
    }

    let opened = live
        .client
        .new_session(state.root.clone())
        .await
        .map_err(translate)?;

    let shared = shared_store(state)?;
    let store = borrow_store(&shared)?;

    store
        .attach_session(thread_id, &opened.session_id)
        .map_err(persistence)?;

    Ok((thread_id, opened.session_id))
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
    let shared = shared_store(&state)?;
    let store = borrow_store(&shared)?;

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
    let shared = shared_store(&state)?;
    let store = borrow_store(&shared)?;

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
    let shared = shared_store(&state)?;
    let store = borrow_store(&shared)?;

    store.set_pinned(id, request.pinned).map_err(persistence)?;

    Ok(())
}
