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

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use poietica_agent_persistence_native::{AgentStore, StoreError};
use poietica_agent_runtime_native::{
    AcpError, AgentClient, AgentConnection, AgentSpawn, ConfigControl, ConfigPurpose,
    PermissionDesk, RecordedEvent, Recorder, RunSlot, connect,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, async_runtime};
use uuid::Uuid;

use crate::agent_log::SharedLog;
use crate::commands::agent_config::launch_env;
use crate::error::{Error, IpcError, Result};
use crate::paths::agent_database;

type AgentCommandResult<T> = std::result::Result<T, IpcError>;

/// The event the renderer listens on to receive run frames.
pub const AGENT_EVENT: &str = "ai-run-event";

/// How much of the first message stands in as a conversation name.
const TITLE_CHARS: usize = 60;

const NO_SESSION: &str = "no agent session is running";
const POISONED: &str = "the agent session lock was left locked by a panicking task";
const NO_SESSION_ID: &str = "the agent closed the connection before creating a session";
const NO_ANSWER: &str = "the agent session ended before answering";
const NO_READ: &str = "the log read did not finish";

/// 提问和改设置都必须点名一条对话。
///
/// 绑定里这个字段是可选的，语义上不是：不点名以前会落到「连接自带的那条对话」
/// 上，于是这一轮被记进了一条屏幕上不存在的对话。在唯一能验证它的地方拒绝它，
/// 与下面 conversation() 拒绝一个非 UUID 的名字是同一件事。
const NO_CONVERSATION: &str = "no conversation was named";

/// How many turns a conversation opens with.
///
/// Opening a conversation used to read every frame ever recorded under it.
/// A frame is a streamed fragment, so that is tens of thousands of rows for a
/// conversation that has seen real use — parsed on the way out, serialised
/// again over IPC, and reduced once more in the interface, all of it on the
/// click that opened it. Chat clients open a window and reach further back on
/// demand; this is the window.
const RECENT_RUNS: u32 = 40;

/// 后台补建快照时，一批处理多少轮。
const SNAPSHOT_BATCH: i64 = 16;

/// 两批之间让开多久，好让前台的读先过。
const SNAPSHOT_PAUSE: std::time::Duration = std::time::Duration::from_millis(50);

/// The live connection, if one has been started.
///
/// 它不持有对话。哪条对话握着哪个会话写在库里，而一条连接自己不是任何人的对话：
/// 此前它在建立时就凭空建一条并 attach 上去，那一行永远没人看、也永远不会被
/// 回收，只能靠 list_threads 的 WHERE EXISTS 挡在列表之外 —— 用每次读列表都要
/// 付的一次子查询，去遮一次本不该发生的写入。
#[derive(Debug)]
struct Session {
    client: AgentClient,
}

/// Managed state for everything the agent commands need.
#[derive(Debug)]
pub struct AgentRuntime {
    database: PathBuf,
    root: PathBuf,
    slot: RunSlot,
    desk: PermissionDesk,
    session: Mutex<Option<Session>>,
    /// 本次连接开出来的会话号。
    ///
    /// ACP 的 sessionId 只在一条连接内有意义：进程重启之后，agent 不认识上一次
    /// 的会话号。库里存着的那一个因此不是主键而是缓存，寻址之前必须先问这里。
    live: Mutex<HashSet<String>>,
    /// The one connection to the encrypted log, opened on first use.
    ///
    /// Every command used to open one of its own: a credential store
    /// read, a SQLCipher attach and a full migrate, all of it again for
    /// something as ordinary as refreshing the sidebar. The single writer
    /// the log claims to be had never actually existed.
    store: OnceLock<Arc<Mutex<AgentStore>>>,
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
        // The session root is resolved here, once, from the platform rather than
        // from the process. A development run starts the binary inside src-tauri,
        // so the process directory is a build location and never a place the user
        // keeps work.
        let root = handle.path().home_dir()?;

        Ok(Self {
            database: agent_database(handle)?,
            root,
            slot: RunSlot::new(),
            desk: PermissionDesk::new(),
            session: Mutex::new(None),
            live: Mutex::new(HashSet::new()),
            store: OnceLock::new(),
        })
    }
}

/// 起一个 agent 进程要说清的三件事。
///
/// 三条命令都要它，所以它是一个结构而不是三份平铺字段。此前这里是一个
/// command: Option<String>，两处都在撒谎：文档注释写着 defaults to the Kimi
/// ACP entry point，而 resolve_command 里根本没有默认值；字段写着可选，而缺
/// 了它必然报错。
///
/// 名字与参数分开传，因为拼成一行再让 shell 词法切回来是有损的。
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunch {
    /// 要启动的 agent。它决定受控 home 落在哪里。
    pub agent_id: String,
    /// 可执行文件名或路径，不含参数，也不经过 shell。
    pub program: String,
    /// 传给它的参数，原样递给进程。
    pub args: Vec<String>,
}

/// A prompt, and how to start the agent if it is not running yet.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptRequest {
    /// What the user typed.
    pub text: String,
    /// The conversation this turn belongs to, when the interface names one.
    pub thread_id: Option<String>,
    /// 起哪个 agent。
    pub launch: AgentLaunch,
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

    let session = ensure_session(&app, &state, request.launch, request.cwd).await?;

    // 一条对话持有一个会话，这一轮就发往它。
    //
    // 此前的兜底是"查不到就用连接上的第一条会话"，于是在第二条对话里
    // 提问，带的是第一条的上下文与模型。命名的对话若还没有会话，就在
    // 这里为它开一个并记下来——这是 ACP 的会话模型，不是补丁。
    let named = request
        .thread_id
        .as_deref()
        .ok_or_else(|| Error::Validation(NO_CONVERSATION.to_owned()))?;

    let held = session_for(&state, &session, named).await?;
    let thread_id = held.thread_id;
    let addressed = held.session_id;

    // The log is the one thing that must exist before the turn does, so
    // it is taken here rather than handed to a thread whose failure would
    // arrive after the fact. Nothing awaits below this line, so holding the
    // lock to the end of the command keeps this future Send.
    let shared = shared_store(&state)?;
    let store = borrow_store(&shared)?;

    let run_id = store.start_run(thread_id).map_err(persistence)?;

    // The first thing said names the conversation, which is what a
    // conversation in a list should read as. Recorded as coming from the
    // message, so a name the user types later outranks it and this one does
    // not come back.
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

    /* 连接走了，它开出来的会话号也就不再指向任何东西。 */
    if let Ok(mut known) = state.live.lock() {
        known.clear();
    }

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
pub async fn agent_load_run(
    state: State<'_, AgentRuntime>,
    request: AgentLoadRunRequest,
) -> AgentCommandResult<AgentRunSnapshot> {
    let run_id = Uuid::parse_str(&request.run_id)
        .map_err(|_invalid| Error::Validation("the run identifier is not a UUID".to_owned()))?;

    let after_seq = i64::from(request.after_seq.unwrap_or_default());

    let events = on_store(&state, move |store| {
        Ok(store
            .events_since(run_id, after_seq)
            .map_err(persistence)?
            .into_iter()
            .map(|event| event.payload)
            .collect::<Vec<Value>>())
    })
    .await?;

    Ok(AgentRunSnapshot {
        run_id: request.run_id,
        events,
    })
}

/// A request to replay a whole conversation from the log.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoadThreadRequest {
    /// The conversation to read.
    pub thread_id: String,
    /// How many turns to read, newest first; omit for the default window.
    ///
    /// 宽度是界面的决定：只有它知道用户已经翻到哪里、还想不想往前看。这里
    /// 的默认值不是策略，只是没人交代时的兜底。
    pub recent_runs: Option<u32>,
}

/// A conversation as it was recorded.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentThreadTranscript {
    /// The conversation the frames belong to.
    pub thread_id: String,
    /// The frames of the turns inside the window, in the order they happened.
    pub events: Vec<Value>,
    /// How many turns the conversation holds in total.
    ///
    /// The window can be narrower than the conversation, and an interface that
    /// is not told so has no honest way to draw the boundary: it would either
    /// present a fragment as the whole thing, or offer to reach back when there
    /// is nothing behind it.
    pub total_runs: u32,
}

/// Reads a window of a conversation back out of the log.
///
/// Opening a conversation is reading one, so this is what the interface calls
/// when the user picks one: the frames are the same values that were broadcast
/// while each turn was live, which is why a conversation reopened cannot drift
/// from having watched it happen.
///
/// A window, because the whole log is tens of thousands of frames for a
/// conversation that has seen real use and all of it would land on the click.
/// The turn count travels with it, so the interface can say where the window
/// ends and ask for a wider one.
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
pub async fn agent_load_thread(
    state: State<'_, AgentRuntime>,
    request: AgentLoadThreadRequest,
) -> AgentCommandResult<AgentThreadTranscript> {
    let Ok(thread_id) = Uuid::parse_str(&request.thread_id) else {
        return Ok(AgentThreadTranscript {
            thread_id: request.thread_id,
            events: Vec::new(),
            total_runs: 0,
        });
    };

    let window = i64::from(request.recent_runs.unwrap_or(RECENT_RUNS));

    /* 一次进池子，两条语句：宽度和总数必须来自同一次读，否则界面会拿到
    一个自相矛盾的答复——比如说"一共 3 轮"却收到 4 轮的帧。 */
    let (events, total_runs) = on_store(&state, move |store| {
        let events = store
            .thread_events(thread_id, window)
            .map_err(persistence)?
            .into_iter()
            .map(|event| event.payload)
            .collect::<Vec<Value>>();

        let total = store.thread_run_count(thread_id).map_err(persistence)?;

        Ok((events, total))
    })
    .await?;

    Ok(AgentThreadTranscript {
        thread_id: request.thread_id,
        events,
        total_runs: u32::try_from(total_runs).unwrap_or(u32::MAX),
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
    /// The conversation the change applies to.
    pub thread_id: Option<String>,
    /// One of the selector identifiers the session reported.
    pub config_id: String,
    /// One of the values that selector offered.
    pub value: String,
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

    /*
     * 改一项设置，发往这条对话所持有的会话。
     *
     * 与提问走同一条 session_for：它认不得的会话号（上一次运行留下的）会在
     * 这里被换成一个新开的，而不是把一个 agent 不认识的名字发出去。
     */
    let named = request
        .thread_id
        .as_deref()
        .ok_or_else(|| Error::Validation(NO_CONVERSATION.to_owned()))?;

    let held = session_for(&state, &live, named).await?;
    let addressed = held.session_id;

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
/// A connection to speak over, and nothing else. 每条命令都点名一条对话，寻址
/// 由库回答，所以这里再没有第二个答案可以被当成兜底 —— 一个只在「查不到」时才
/// 生效的字段，就是一条只在出错时才走的代码路径。
struct Handle {
    client: AgentClient,
}

/// Returns the running session, starting one if there is none.
async fn ensure_session(
    app: &AppHandle,
    state: &State<'_, AgentRuntime>,
    launch: AgentLaunch,
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

    // 受控 home 在这里被解析成一个环境变量。写 provider 用的是 agent 自己的
    // CLI，起会话用的是这条连接，两边必须指向同一个目录 —— 否则 provider 写
    // 进了一个 home，而对话读的是另一个：界面上 provider 添加成功，一开口却
    // 说没有可用的模型。
    let env = launch_env(app, &launch.agent_id)?;

    let spawn = AgentSpawn {
        program: launch.program,
        args: launch.args,
        cwd: working_directory,
        env,
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

    let mut guard = lock(&state.session)?;

    // Two prompts can race to be the first. The loser hands its process back
    // rather than leaving an orphan behind.
    if let Some(live) = guard.as_ref() {
        let _ignored = client.shutdown();

        return Ok(Handle {
            client: live.client.clone(),
        });
    }

    *guard = Some(Session {
        client: client.clone(),
    });

    /* 连接建立时自带的会话号：没有对话持有它，但寻址按号认人，所以要认得。 */
    remember(state, &session_id)?;

    Ok(Handle { client })
}

/// Reads the session without holding the lock across an await point.
fn borrow(state: &State<'_, AgentRuntime>) -> Result<Option<Handle>> {
    let guard = lock(&state.session)?;

    Ok(guard.as_ref().map(|live| Handle {
        client: live.client.clone(),
    }))
}

/// The one connection, opened the first time anything needs it.
///
/// Not at boot: opening it reads the operating system credential store, and
/// a launch that never opens the assistant should not pay for that. Once,
/// though, and not once per command.
fn shared_store(state: &State<'_, AgentRuntime>) -> Result<Arc<Mutex<AgentStore>>> {
    if let Some(held) = state.store.get() {
        return Ok(Arc::clone(held));
    }

    let opened = Arc::new(Mutex::new(
        AgentStore::open(&state.database).map_err(persistence)?,
    ));

    // Two commands can race to be the first. The loser's connection is
    // dropped and everyone uses the winner's, which is the whole point.
    let shared = Arc::clone(state.store.get_or_init(|| Arc::clone(&opened)));

    // 赢的那一个顺便把存量对话的快照补上，一次运行一趟。
    //
    // 挂在这里而不是启动时，是因为打开日志本身就是懒的（见上面那段）：一次
    // 从不打开助手的启动，不该为此去读一遍凭据库。日志第一次被真正打开的这
    // 一刻，才是"这个人要用助手了"的那一刻。
    if Arc::ptr_eq(&shared, &opened) {
        catch_up_snapshots(Arc::clone(&shared));
    }

    Ok(shared)
}

/// 把还没有快照的存量轮次在后台补齐。
///
/// 一批一批地做，每批之间放开锁：补建是为了让点击变快，它自己不能反过来把
/// 点击堵在锁外面。做完就退出。
///
/// 这一趟没跑完也没关系，剩下的轮次下一次运行接着补，中途读到它们只是走回
/// 日志那条慢路 —— 也就是今天的行为。
fn catch_up_snapshots(shared: Arc<Mutex<AgentStore>>) {
    async_runtime::spawn_blocking(move || {
        loop {
            let done = match shared.lock() {
                Ok(store) => store.compact_backlog(SNAPSHOT_BATCH),
                Err(_poisoned) => return,
            };

            match done {
                Ok(0) => return,
                Ok(_more) => std::thread::sleep(SNAPSHOT_PAUSE),
                Err(error) => {
                    log::warn!("could not compact stored turns: {error}");
                    return;
                }
            }
        }
    });
}

/// Takes the connection for the length of one statement.
///
/// Never held across an await: a guard that is would make the command's
/// future not Send, which is why this is a separate step from taking the
/// share above rather than one call that does both.
fn borrow_store(shared: &Arc<Mutex<AgentStore>>) -> Result<MutexGuard<'_, AgentStore>> {
    shared
        .lock()
        .map_err(|_poisoned| Error::Internal(POISONED.to_owned()))
}

/// Reads or writes the log without standing on the main thread.
///
/// A command that is not `async` runs on the main thread, and one read of a
/// conversation is a credential store lookup, a SQLCipher attach, a join
/// across the whole log and a JSON parse per frame. Put that on the main
/// thread and the window stops answering: the sidebar does not highlight,
/// the click does not land, and the conversation looks broken rather than
/// slow.
///
/// The two halves are separate on purpose. Taking the share needs the
/// managed state, which is borrowed; running the work needs `'static`. So
/// the handle is taken here and the statement is handed to the pool.
async fn on_store<T, F>(state: &State<'_, AgentRuntime>, work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&AgentStore) -> Result<T> + Send + 'static,
{
    let shared = shared_store(state)?;

    async_runtime::spawn_blocking(move || {
        let store = borrow_store(&shared)?;

        work(&store)
    })
    .await
    .map_err(|_dropped| Error::Internal(NO_READ.to_owned()))?
}

fn lock(session: &Mutex<Option<Session>>) -> Result<MutexGuard<'_, Option<Session>>> {
    session
        .lock()
        .map_err(|_poisoned| Error::Internal(POISONED.to_owned()))
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
    /// 起哪个 agent。
    pub launch: AgentLaunch,
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
    app: AppHandle,
    state: State<'_, AgentRuntime>,
    request: AgentNewSessionRequest,
) -> AgentCommandResult<AgentOpenedSession> {
    let asked = request.cwd.clone();
    let live = ensure_session(&app, &state, request.launch, request.cwd).await?;

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

    /* 这个会话号只在这条连接里有意义，寻址之前必须先认得它。 */
    remember(&state, &opened.session_id)?;

    Ok(AgentOpenedSession {
        session_id: opened.session_id,
        selectors: opened.selectors.into_iter().map(restate).collect(),
    })
}

/// Lists the sessions the agent itself keeps.
///
/// The title is whatever the agent wrote in its own store when it created
/// the session, reported here unchanged. It is not a conversation name and
/// is not treated as one: this program names its own conversations, because
/// an agent that never revises New Session would otherwise name every one
/// of them that.
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
    /// Where that name came from: manual, message or fallback.
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
/// A read, and nothing but a read. It used to open with a round trip to the
/// agent for its session list and write those names in, which is where every
/// conversation in this list got the name New Session: that title is what
/// the agent called the session in its own store, it is never revised, and
/// it was ranked above the first thing the user actually said.
///
/// Dropping it takes a subprocess round trip and a write transaction off the
/// path that draws the sidebar, and takes the whole read off the main thread.
/// The names shown are now decided in one place, by the ranking in
/// TitleSource.
///
/// # Errors
///
/// Fails when the database cannot be opened or read.
#[tauri::command]
#[specta::specta]
pub async fn agent_threads(state: State<'_, AgentRuntime>) -> AgentCommandResult<Vec<AgentThread>> {
    let stored = on_store(&state, |store| store.list_threads().map_err(persistence)).await?;

    Ok(stored.into_iter().map(retitle).collect())
}

/// 要打开的对话，以及必要时怎样启动 agent。
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentOpenThreadRequest {
    /// 已经存在的对话；不点名就新开一条。
    pub thread_id: Option<String>,
    /// 起哪个 agent。
    pub launch: AgentLaunch,
    /// The working directory the session is created against.
    pub cwd: Option<String>,
}

/// 打开一条对话：让它握住一个这条连接认得的会话。
///
/// 不点名就先落一行，再为它开会话；点开一条上次运行留下的对话时，session_for
/// 认出它存着的会话号不是本次连接开的，于是重开一个并改写持有关系。两条路都在
/// 同一次答复里带回整张选择器表，界面因此从不需要"读一次设置"——那个读命令正是
/// 因此被删掉的。
///
/// # Errors
///
/// Fails when the agent cannot be started, when a turn is in flight on
/// the connection, or when the database rejects the write.
#[tauri::command]
#[specta::specta]
pub async fn agent_open_thread(
    app: AppHandle,
    state: State<'_, AgentRuntime>,
    request: AgentOpenThreadRequest,
) -> AgentCommandResult<AgentOpenedThread> {
    let live = ensure_session(&app, &state, request.launch, request.cwd).await?;

    let named = match request.thread_id {
        Some(given) => given,
        None => {
            let shared = shared_store(&state)?;
            let store = borrow_store(&shared)?;

            store
                .create_thread(FALLBACK_THREAD_TITLE)
                .map_err(persistence)?
                .to_string()
        }
    };

    let held = session_for(&state, &live, &named).await?;

    let offered = match held.offered {
        Some(offered) => offered,
        /* 本次运行已经为它开过会话：只有这一种情况需要把表再问一次。 */
        None => {
            let answer = live.client.selectors(held.session_id).map_err(translate)?;

            answer
                .await
                .map_err(|_dropped| Error::Internal(NO_ANSWER.to_owned()))?
                .map_err(translate)?
        }
    };

    // list_threads leaves out conversations that have had no turns, on
    // purpose: a list of conversations lists ones that happened, so the row
    // just created has to be read on its own.
    let thread = {
        let shared = shared_store(&state)?;
        let store = borrow_store(&shared)?;

        store
            .thread(held.thread_id)
            .map_err(persistence)?
            .map(retitle)
            .ok_or_else(|| Error::Internal(NO_THREAD.to_owned()))?
    };

    Ok(AgentOpenedThread {
        thread,
        selectors: offered.into_iter().map(restate).collect(),
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

/// 一条对话所持有的活会话，以及开它时 agent 报的那张选择器表。
struct Held {
    thread_id: Uuid,
    session_id: String,
    /// 只有刚开出来的会话有：agent 在同一个答复里报了它。
    offered: Option<Vec<ConfigControl>>,
}

/// 记下一个本次连接开出来的会话号。
fn remember(state: &State<'_, AgentRuntime>, session_id: &str) -> Result<()> {
    state
        .live
        .lock()
        .map_err(|_poisoned| Error::Internal(POISONED.to_owned()))?
        .insert(session_id.to_owned());

    Ok(())
}

/// 本次连接是否认得这个会话号。
fn recognised(state: &State<'_, AgentRuntime>, session_id: &str) -> Result<bool> {
    Ok(state
        .live
        .lock()
        .map_err(|_poisoned| Error::Internal(POISONED.to_owned()))?
        .contains(session_id))
}

/// 这条对话所持有的、本次连接认得的会话。
///
/// 整个模块只有这一条寻址规则，没有兜底。对话持有会话，attach_session 是写下
/// 来的地方——但写下来的那一个只在开它的那条连接里有意义：ACP 的会话号随连接
/// 生灭，进程重启之后 agent 不认识它。此前它被当成持久主键直接用于寻址，于是
/// 一条上次运行留下的对话，它的选择器和它的每一轮提问都发往一个早已不存在的
/// 会话：前者是屏幕上那句"会话设置读取失败"，后者是一轮永远不会开始的回答。
///
/// 认不得就重开一个并改写这条对话的持有关系。新开的会话，agent 在同一个答复里
/// 报了整张选择器表，所以第二个字段只在这种情况下有值：这不是缓存，是省掉一次
/// 多余的往返。
///
/// 会话的工作目录是平台给的答案（state.root），不是进程的当前目录。
async fn session_for(state: &State<'_, AgentRuntime>, live: &Handle, named: &str) -> Result<Held> {
    let thread_id = conversation(named)?;

    let stored = {
        let shared = shared_store(state)?;
        let store = borrow_store(&shared)?;

        store.session_for_thread(thread_id).map_err(persistence)?
    };

    if let Some(session_id) = stored {
        if recognised(state, &session_id)? {
            return Ok(Held {
                thread_id,
                session_id,
                offered: None,
            });
        }
    }

    let opened = live
        .client
        .new_session(state.root.clone())
        .await
        .map_err(translate)?;

    {
        let shared = shared_store(state)?;
        let store = borrow_store(&shared)?;

        store
            .attach_session(thread_id, &opened.session_id)
            .map_err(persistence)?;
    }

    remember(state, &opened.session_id)?;

    Ok(Held {
        thread_id,
        session_id: opened.session_id,
        offered: Some(opened.selectors),
    })
}

/// Renames a conversation.
///
/// The name is recorded as the user's, which outranks the opening message
/// it replaces: that question has already been answered by the person who
/// typed it.
///
/// # Errors
///
/// Fails when the identifier is not a UUID, the name is empty, or the
/// database rejects the write.
#[tauri::command]
#[specta::specta]
pub async fn agent_rename_thread(
    state: State<'_, AgentRuntime>,
    request: AgentRenameThreadRequest,
) -> AgentCommandResult<()> {
    let title: String = request.title.trim().chars().take(TITLE_CHARS).collect();

    if title.is_empty() {
        return Err(Error::Validation("the conversation name is empty".to_owned()).into());
    }

    let id = conversation(&request.thread_id)?;

    on_store(&state, move |store| {
        store.name_by_user(id, &title).map_err(persistence)
    })
    .await?;

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
pub async fn agent_delete_thread(
    state: State<'_, AgentRuntime>,
    request: AgentThreadRequest,
) -> AgentCommandResult<()> {
    let id = conversation(&request.thread_id)?;

    on_store(&state, move |store| {
        store.delete_thread(id).map_err(persistence)
    })
    .await?;

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
pub async fn agent_pin_thread(
    state: State<'_, AgentRuntime>,
    request: AgentPinThreadRequest,
) -> AgentCommandResult<()> {
    let id = conversation(&request.thread_id)?;
    let pinned = request.pinned;

    on_store(&state, move |store| {
        store.set_pinned(id, pinned).map_err(persistence)
    })
    .await?;

    Ok(())
}
