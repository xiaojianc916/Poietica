//! The desktop seam onto the ACP client.
//!
//! Three rules shape this module.
//!
//! The session is started once and reused. A turn is cheap; a process and a
//! protocol handshake are not, and a session that restarted between turns
//! would throw away the context the agent has built up.
//!
//! 一段对话的持有者是 agent，不是这一侧。打开它就是请 agent 把它装载回来，
//! 重放的帧随 `agent_open_thread` 一起交出去。这一侧不再留第二份记录：本地
//! 库现在只是一张索引，记着有哪些对话、叫什么、各自握着谁的哪个会话。
//!
//! An answer arriving from the renderer is untrusted. The desk checks it
//! against the options the agent actually offered before anything is recorded
//! or sent.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use poietica_agent_persistence_native::{AgentStore, StoreError, TitleSource};
use poietica_agent_runtime_native::{
    AcpError, AgentClient, AgentConnection, AgentSpawn, ConfigControl, ConfigPurpose,
    PermissionDesk, RecordedEvent, Refusal, RunSlot, connect,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, async_runtime};
use uuid::Uuid;

use crate::commands::agent_config::launch_env;
use crate::error::{Error, IpcError, Result};
use crate::paths::agent_database;

type AgentCommandResult<T> = std::result::Result<T, IpcError>;

/// The event the renderer listens on to receive run frames.
pub const AGENT_EVENT: &str = "ai-run-event";

/// 会话自己报来的选择器表走这一条。
///
/// 与 [`AGENT_EVENT`] 分开，因为它们说的不是一件事：那一条是某一轮里的一帧，
/// 而这一条不属于任何一轮 —— agent 在 session/update 里推 `config_option_update`
/// 时可能正在答话，也可能没有。混进同一条通道，就得让渲染层去分辨，而分辨的
/// 依据只会是一个字符串标签。
pub const AGENT_SELECTOR_EVENT: &str = "ai-selector-report";

/// How much of the first message stands in as a conversation name.
const TITLE_CHARS: usize = 60;

const NO_SESSION: &str = "no agent session is running";
const POISONED: &str = "the agent session lock was left locked by a panicking task";
const NO_SESSION_ID: &str = "the agent closed the connection before creating a session";
const NO_ANSWER: &str = "the agent session ended before answering";
const NO_READ: &str = "the database read did not finish";

/// 提问和改设置都必须点名一条对话。
///
/// 绑定里这个字段是可选的，语义上不是：不点名以前会落到「连接自带的那条对话」
/// 上，于是这一轮被记进了一条屏幕上不存在的对话。在唯一能验证它的地方拒绝它，
/// 与下面 `conversation()` 拒绝一个非 UUID 的名字是同一件事。
const NO_CONVERSATION: &str = "no conversation was named";

/// 要停的那条对话此刻没有会话可发。
///
/// 这不是兜底：会话是在打开这条对话时才握上的，查不到恰好是「没有什么可停的」。
const NOTHING_TO_STOP: &str = "that conversation is not running";

/// The live connection, if one has been started.
///
/// 它不持有对话。哪条对话握着哪个会话写在库里，而一条连接自己不是任何人的对话：
/// 此前它在建立时就凭空建一条并 attach 上去，那一行永远没人看、也永远不会被
/// 回收，只能靠列表的过滤条件挡在外面 —— 用每次读列表都要付的一次判断，去遮
/// 一次本不该发生的写入。
#[derive(Debug)]
struct Connection {
    client: AgentClient,
    /// 这条连接起的是哪个 agent。寻址要拿它跟对话记下的那个比。
    agent_id: String,
    /// 这条连接自带的那个会话号。
    ///
    /// `connect()` 建立连接时就开了它，而没有任何对话持有它 —— 模块头那段注释里
    /// 被吐槽过的"凭空建一条对话"说的就是它当年的下场。它现在有了用途：问这个
    /// agent 提供什么的时候，总得有一个会话可以问，而那个问题与任何一条对话都
    /// 无关。所以它是锚，不是对话的会话。
    anchor: String,
    /// 这个 agent 会不会装载一条旧会话。握手时问出来的，一条连接一份。
    can_load_session: bool,
    /// 这个 agent 会不会删掉一条会话。同样是握手问出来的。
    can_delete_session: bool,
}

/// Managed state for everything the agent commands need.
#[derive(Debug)]
pub struct AgentRuntime {
    database: PathBuf,
    root: PathBuf,
    slot: RunSlot,
    desk: PermissionDesk,
    connection: Mutex<Option<Connection>>,
    /// 本次连接开出来的会话号。
    ///
    /// ACP 的 sessionId 只在一条连接内有意义：进程重启之后，agent 不认识上一次
    /// 的会话号。库里存着的那一个因此不是主键而是缓存，寻址之前必须先问这里。
    live: Mutex<HashSet<String>>,
    /// The one connection to the encrypted index, opened on first use.
    ///
    /// Every command used to open one of its own: a credential store
    /// read, a `SQLCipher` attach and a full migrate, all of it again for
    /// something as ordinary as refreshing the sidebar. The single writer
    /// this file claims to have had never actually existed.
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
            connection: Mutex::new(None),
            live: Mutex::new(HashSet::new()),
            store: OnceLock::new(),
        })
    }
}

/// 起一个 agent 进程要说清的三件事。
///
/// 三条命令都要它，所以它是一个结构而不是三份平铺字段。此前这里是一个
/// command: Option<String>，两处都在撒谎：文档注释写着 defaults to the Kimi
/// ACP entry point，而 `resolve_command` 里根本没有默认值；字段写着可选，而缺
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
    /// 这一轮发到了哪条会话。它的每一帧都带着同一个号。
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

/// Starts a turn and returns as soon as it is under way.
///
/// The answer to the prompt is not awaited here. Frames arrive on
/// [`AGENT_EVENT`] as they are recorded, which is what the timeline consumes;
/// blocking the caller until the agent stopped would defeat the point.
///
/// # Errors
///
/// Fails when the prompt is empty, the agent cannot be started, or the
/// conversation's name cannot be written.
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

    /* 提问不需要历史：屏幕上正看着的就是这条对话。 */
    let held = session_for(&state, &session, named, Wanted::Address).await?;
    let thread_id = held.thread_id;
    let addressed = held.session_id;

    // The first thing said names the conversation, which is what a
    // conversation in a list should read as. Recorded as coming from the
    // message, so a name the user types later outranks it and this one does
    // not come back.
    let opener: String = text.chars().take(TITLE_CHARS).collect();

    // 括号是为了让锁在这里就还回去：下面还有 await，而一个跨 await 持有的
    // guard 会让这个 future 不再 Send。
    {
        let shared = shared_store(&state)?;
        let store = borrow_store(&shared)?;

        store
            .name_from_message(thread_id, &opener)
            .map_err(persistence)?;
    }

    let handle = app.clone();
    let frames = Box::new(move |event: &RecordedEvent| {
        // 渲染层没在听不是错：这条对话下次打开时，历史由持有它的 agent
        // 随 agent_open_thread 一起交回来。
        let _ignored = handle.emit(AGENT_EVENT, event);
    });

    let answer = session
        .client
        .prompt(addressed.clone(), text, frames)
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

/// 要停的那条对话。
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentCancelRequest {
    /// The conversation whose turn should stop.
    pub thread_id: String,
}

/// Asks the agent to stop the turn running on one conversation.
///
/// 取消点名一条对话。ACP 的取消是发给一条会话的，而一条对话持有一条会话 ——
/// 这条对应关系在打开这条对话时就写进了库（attach_session），提问走的也是它。
/// 此前这里点名的是一个轮次号，为它在内存里另养了一张 runId → sessionId 的表，
/// 一轮开始时写、结束时删：那张表回答的问题，库里本来就有答案。
///
/// 只读寻址，不惊动 agent。查不到就是没有什么可停的 —— 走 session_for 会为一条
/// 还没开过口的对话新开一个会话，那是纯副作用。
///
/// 它是 async 的，因为它要读一次库。同步命令跑在主线程上，而一次库读是一次凭据
/// 库查询加一次 SQLCipher attach，窗口会在那段时间里停止应答（见 on_store）。
///
/// Cancellation is cooperative: the agent may still finish normally, and the
/// recorded stop reason reports which of the two happened.
///
/// # Errors
///
/// Fails when that conversation holds no live session, when no session is
/// running, or when the driver has stopped.
#[tauri::command]
#[specta::specta]
pub async fn agent_cancel(
    state: State<'_, AgentRuntime>,
    request: AgentCancelRequest,
) -> AgentCommandResult<()> {
    let live = borrow(&state)?.ok_or_else(|| Error::NotFound(NO_SESSION.to_owned()))?;

    let id = conversation(&request.thread_id)?;
    let stored = on_store(&state, move |store| store.thread(id).map_err(persistence)).await?;

    /* 持有者对不上就不发：会话号活在各自 agent 的命名空间里，把 A 的号发给 B
    停的可能是 B 的东西。与 session_for 和 agent_delete_thread 同一条规矩。 */
    let held = stored.and_then(|thread| {
        let owner = thread.agent_id;

        thread
            .session_id
            .filter(|_| owner.as_deref().is_none_or(|agent| agent == live.agent_id))
    });

    let Some(addressed) = held else {
        return Err(Error::NotFound(NOTHING_TO_STOP.to_owned()).into());
    };

    /* 本次连接认不得的号是上次运行留下的：那条会话上没有这一侧发起的轮次。 */
    if !recognised(&state, &addressed)? {
        return Err(Error::NotFound(NOTHING_TO_STOP.to_owned()).into());
    }

    live.client.cancel(addressed).map_err(translate)?;

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
    let taken = lock(&state.connection)?.take();

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

/// agent 自己换了设置之后报回来的整张表。
///
/// 它带着 `session_id`，因为这是它唯一带得出的地址：帧里没有对话，会话号是
/// agent 那侧的命名。反查由渲染层用「开这条会话时是哪条对话」去做。
///
/// 它不出现在任何命令签名里，所以不进生成绑定 —— 事件不是命令。线上的形状
/// 由这里的 serde 属性说了算。
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSelectorReport {
    /// 报这张表的那条会话。
    pub session_id: String,
    /// 那条会话上现在的整张选择器表。
    pub selectors: Vec<AgentConfigControl>,
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

    let held = session_for(&state, &live, named, Wanted::Address).await?;
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

/// 问这个 agent 提供什么，不点名任何一条对话。
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilitiesRequest {
    /// 起哪个 agent。
    pub launch: AgentLaunch,
    /// The working directory the session is created against.
    pub cwd: Option<String>,
}

/// 这个 agent 提供哪些选择器。
///
/// 能力属于 agent，不属于某一轮对话 —— 模型清单在 ACP 里由 initialize 阶段的
/// 握手与 agent 自己的配置决定，一条会话只是从里面选了一个当前值。此前这张表
/// 只有两个出口，都要先有一个会话，而会话的归属要先有一条对话（`session_for`）：
/// 于是入口界面（还没有对话、也没有会话）在结构上不可能画出模型选择器，而渲染
/// 层只能拿上一次学到的表去缓存 —— 那是替一条不存在的取数路径打掩护。
///
/// 这里问的是锚会话：`connect()` 建立连接时本来就交回一个会话号，没有任何对话
/// 持有它。所以这条命令不新开会话、不写库、不碰任何 thread。
///
/// 它仍然会按需起进程：一个从没打开过助手的启动不该为此付钱，而一旦有人要看
/// 模型清单，进程就是要起的。
///
/// # Errors
///
/// Fails when the agent cannot be started, when a turn is in flight on the
/// connection, or when the agent refuses to report its selectors.
#[tauri::command]
#[specta::specta]
pub async fn agent_capabilities(
    app: AppHandle,
    state: State<'_, AgentRuntime>,
    request: AgentCapabilitiesRequest,
) -> AgentCommandResult<Vec<AgentConfigControl>> {
    let live = ensure_session(&app, &state, request.launch, request.cwd).await?;

    let answer = live.client.selectors(live.anchor).map_err(translate)?;

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
    /// 这条连接起的是哪个 agent。
    agent_id: String,
    /// 这条连接的锚会话。问 agent 能力时发往它。
    anchor: String,
    /// 这个 agent 会不会装载一条旧会话。寻址要按它分路。
    can_load_session: bool,
    /// 这个 agent 会不会删掉一条会话。删除要按它分路。
    can_delete_session: bool,
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
    let AgentLaunch {
        agent_id,
        program,
        args,
    } = launch;

    let env = launch_env(app, &agent_id)?;

    let spawn = AgentSpawn {
        program,
        args,
        cwd: working_directory,
        env,
    };

    // The book that files frames under the session that names them belongs
    // to the connection, and the driver holds its own handle to it, so
    // routing works while this side leaves it alone. The runtime takes it
    // over once it keeps more than one session at a time.
    let AgentConnection {
        client,
        handshake,
        driver,
        reports,
        book: _,
    } = connect(spawn, state.slot.clone(), state.desk.clone()).map_err(translate)?;

    // The crate is runtime-agnostic on purpose; this is the composition root,
    // so this is where the driver gets an executor.
    async_runtime::spawn(async move {
        if let Err(error) = driver.await {
            log::error!("the agent session ended: {error}");
        }
    });

    // agent 自己改了设置，这里把它送上屏。
    //
    // 一条连接一个排空任务：报告是 agent 主动推的，不挂在任何一次往返的答复
    // 上，所以没有任何命令可以顺路把它带回去。通道关掉（连接没了）时循环自己
    // 结束，任务随之退出。
    //
    // 发的是引用：emit 要 Serialize + Clone，而 &T 两样都满足，上面那条运行帧
    // 通道也是这么发的。为一个只发一次的载荷去 derive Clone 是多余的。
    let herald = app.clone();

    async_runtime::spawn(async move {
        let mut reports = reports;

        while let Some(report) = reports.next().await {
            let payload = AgentSelectorReport {
                session_id: report.session_id,
                selectors: report.controls.into_iter().map(restate).collect(),
            };

            // 渲染层没在听不是错：下一次 open 这条对话仍然会拿到权威的整张表。
            let _ignored = herald.emit(AGENT_SELECTOR_EVENT, &payload);
        }
    });

    /* 通道现在两头都说得出话：Canceled 是发送端没了，Err 是握手自己报的原因。 */
    let handshake = handshake
        .await
        .map_err(|_dropped| Error::Internal(NO_SESSION_ID.to_owned()))?
        .map_err(translate)?;

    let session_id = handshake.session_id;
    let can_load_session = handshake.can_load_session;
    let can_delete_session = handshake.can_delete_session;

    let mut guard = lock(&state.connection)?;

    // Two prompts can race to be the first. The loser hands its process back
    // rather than leaving an orphan behind.
    if let Some(live) = guard.as_ref() {
        let _ignored = client.shutdown();

        return Ok(Handle {
            client: live.client.clone(),
            agent_id: live.agent_id.clone(),
            anchor: live.anchor.clone(),
            can_load_session: live.can_load_session,
            can_delete_session: live.can_delete_session,
        });
    }

    *guard = Some(Connection {
        client: client.clone(),
        agent_id: agent_id.clone(),
        anchor: session_id.clone(),
        can_load_session,
        can_delete_session,
    });

    /* 连接建立时自带的会话号：没有对话持有它，但寻址按号认人，所以要认得。 */
    remember(state, &session_id)?;

    Ok(Handle {
        client,
        agent_id,
        anchor: session_id,
        can_load_session,
        can_delete_session,
    })
}

/// Reads the session without holding the lock across an await point.
fn borrow(state: &State<'_, AgentRuntime>) -> Result<Option<Handle>> {
    let guard = lock(&state.connection)?;

    Ok(guard.as_ref().map(|live| Handle {
        client: live.client.clone(),
        agent_id: live.agent_id.clone(),
        anchor: live.anchor.clone(),
        can_load_session: live.can_load_session,
        can_delete_session: live.can_delete_session,
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
    Ok(Arc::clone(state.store.get_or_init(|| opened)))
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
/// A command that is not `async` runs on the main thread, and even a read of
/// the index is a credential store lookup and a `SQLCipher` attach before a
/// single row comes back. Put that on the main thread and the window stops
/// answering: the sidebar does not highlight, the click does not land, and
/// the conversation looks broken rather than slow.
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

/// 取那条连接，一句话的功夫。
///
/// 这个结构此前叫 `Session`，而它自己的文档第一行写着「一条连接自己不是任何
/// 人的对话」。会话在这个模块里是一个有精确含义的协议名词：一条连接上有很多
/// 条，每条属于一个对话。把连接叫成会话，等于让每一次读到 `state.connection` 的
/// 人都在脑子里转换一次。
fn lock(connection: &Mutex<Option<Connection>>) -> Result<MutexGuard<'_, Option<Connection>>> {
    connection
        .lock()
        .map_err(|_poisoned| Error::Internal(POISONED.to_owned()))
}

fn persistence(error: StoreError) -> Error {
    Error::Persistence(error.to_string())
}

/// 这一侧自己判定的拒绝，说的话。
///
/// 全是本仓库的字面量常量，没有一处把 agent 的回话、外部输入或系统错误拼进去
/// —— 这正是 `Error::AgentCli` 那个变体写下来的透传判据，所以它们可以原样上屏。
/// 而这三件恰恰是用户唯一能自己解决的事。
const fn refusal(reason: Refusal) -> &'static str {
    match reason {
        Refusal::UnknownSession => "这条对话的会话已经失效，请重新打开它",
        Refusal::Gone => "agent 已经退出，请重新发起对话",
        Refusal::Busy => "这条对话正在回答，请等它结束再改设置",
    }
}

/// Folds an agent failure into the application's existing error surface.
///
/// 分两路，因为两边的来源不同。这一侧判定的拒绝是本仓的字面量，原样上屏；agent
/// 报回来的原因可能带路径或系统细节，仍然落到 `Internal` 的固定文案 —— 但先写进
/// 日志。
///
/// 此前两路合一：七种互不相同的失败共用一句「应用操作失败」，且那个 message 在
/// 这一行之后再没有任何地方留下过。原来的注释说「不给 agent 加变体，多一条 arm
/// 就是新的泄漏口」，那句话把两件事混了 —— 泄漏来自把 native detail 当成
/// `public_message` 原样返回，不来自多一个变体。
fn translate(error: AcpError) -> Error {
    match error {
        AcpError::Encoding(inner) => Error::SerdeJson(inner),
        AcpError::Refused(reason) => Error::AgentCli(refusal(reason).to_owned()),
        // The enum is non-exhaustive, so the wildcard arm is required.
        //
        // 原样上屏，不换一句好听的。这是一个桌面单机程序：屏幕前的人就是跑这个
        // 进程的人，agent 的回话对他不是秘密，是他唯一拿得去排查的东西。此前这
        // 里折成一句「应用操作失败」，于是 "Authentication required" 只留在日志
        // 里 —— 而上一版我把它换成了一句猜出来的「多半是还没登录」，那比不说更
        // 坏：它用一个不确切的说法顶掉了一个确切的说法。
        other => {
            log::error!("the agent request failed: {other}");

            Error::AgentCli(other.to_string())
        }
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

/// Where a conversation's name came from.
///
/// A closed set of three, and the interface ranks on it: a name the user
/// typed is never replaced by one derived from the text. Carried across as a
/// free string, that ranking had to be re-asserted at every call site, and
/// the list written down in the generated bindings had already drifted — it
/// still named an `official` source, which [`TitleSource`] removed when this
/// program stopped taking conversation names from the agent.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AgentTitleSource {
    /// Taken from the first thing the user said.
    Message,
    /// Shown before there was anything to take a name from.
    Fallback,
    /// The user typed it. Nothing derived replaces it.
    Manual,
}

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
    /// Where that name came from.
    pub title_source: AgentTitleSource,
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
    /// 这条对话的经过，由持有它的 agent 交回来。
    ///
    /// 帧的形状与实时那条通道上的一模一样 —— 两者由同一个 `acp_update` 做出来
    /// （见运行时 crate 的 frame.rs），所以重开一条对话与看着它发生不可能对不上。
    ///
    /// 空只有一种理由是理所应当的：这条对话刚建。其余的空都是"有经过但拿不
    /// 到"，由下面那一格说清是为什么。
    pub events: Vec<Value>,
    /// 上面那格为什么是它现在的样子。
    ///
    /// 空数组自己说不出区别：刚建的对话与一条打不开的旧对话长得一样。界面
    /// 要据此决定是画入口提示，还是画一句"这段历史在某某手里"。
    pub history: AgentHistory,
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
/// `TitleSource.`
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

/// 打开一条对话：把它整条要回来。
///
/// 不点名就先落一行，再为它开会话；点开一条上次运行留下的对话时，`session_for`
/// 认出它存着的会话号不是本次连接开的，于是请 agent 把那条会话装载回来 —— 号
/// 不变，而 agent 在装载期间用 session/update 把这条对话重放一遍 —— 那些帧就
/// 是历史本身，随这次答复一起交出去。只有 agent 说它不装载旧会话时才重开一条。
///
/// 历史从这里回来，不从别处。屏幕上曾经显示的是本地日志里的另一份，于是同一
/// 段对话有两个来源，而只有一个是 agent 手里那份 —— 两份一旦分叉，人看见的是
/// 对的那份的赝品。现在只有一份，它的持有者是这条会话的主人。
///
/// 每一次打开都问一次经过，本次连接开的那些会话也不例外。渲染层可以在连接
/// 还活着的时候整个重来 —— Ctrl+R 就是，开第二个窗口也是 —— 那一刻它手里什么
/// 都没有，而这一侧只知道"会话还在"。用后者去猜前者，猜错的那次就是一块永远
/// 填不上的白板。
///
/// 三条路都在同一次答复里带回整张选择器表，界面因此从不需要"读一次设置"。
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

    let named = if let Some(given) = request.thread_id {
        given
    } else {
        let shared = shared_store(&state)?;
        let store = borrow_store(&shared)?;

        store
            .create_thread(FALLBACK_THREAD_TITLE)
            .map_err(persistence)?
            .to_string()
    };

    let Held {
        thread_id,
        session_id,
        offered,
        events,
        history,
    } = session_for(&state, &live, &named, Wanted::History).await?;

    let offered = if let Some(offered) = offered {
        offered
    } else {
        /* 本次运行已经为它开过会话：只有这一种情况需要把表再问一次。 */
        let answer = live.client.selectors(session_id).map_err(translate)?;

        answer
            .await
            .map_err(|_dropped| Error::Internal(NO_ANSWER.to_owned()))?
            .map_err(translate)?
    };

    // 列表故意漏掉还没有人开口的对话，而刚建的这一行正是那种，所以它只能
    // 单独读回来。判据现在是标题源，见 threads.rs 的 list_threads。
    let thread = {
        let shared = shared_store(&state)?;
        let store = borrow_store(&shared)?;

        store
            .thread(thread_id)
            .map_err(persistence)?
            .map(retitle)
            .ok_or_else(|| Error::Internal(NO_THREAD.to_owned()))?
    };

    Ok(AgentOpenedThread {
        thread,
        selectors: offered.into_iter().map(restate).collect(),
        events,
        history,
    })
}

/// Restates one stored conversation in the shape the bindings carry.
fn retitle(thread: poietica_agent_persistence_native::ThreadSummary) -> AgentThread {
    AgentThread {
        thread_id: thread.id,
        session_id: thread.session_id,
        title: thread.title,
        title_source: match thread.title_source {
            TitleSource::Message => AgentTitleSource::Message,
            TitleSource::Fallback => AgentTitleSource::Fallback,
            TitleSource::Manual => AgentTitleSource::Manual,
        },
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

/// 一段历史打不开的时候，是因为什么。
///
/// 三种，都不是这一侧的故障，也都不是可以重试的：会话在对面手里，而对面
/// 要么不是同一个 agent，要么不做这件事，要么自己也不留着了。
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AgentHistoryLoss {
    /// 这条对话是另一个 agent 开的。
    ///
    /// sessionId 活在各自 agent 的命名空间里，把 A 的号发给 B 只会换回一句
    /// UnknownSession —— 所以这里根本不发。
    OtherAgent,
    /// 这个 agent 在握手时说了它不装载旧会话。
    NotSupported,
    /// 号发过去了，agent 说它这边已经没有这条会话。
    Forgotten,
}

/// 这一次打开，屏幕上应该出现什么。
///
/// 加这一格是因为四种截然不同的处境此前长得一模一样：`events` 都是空数组。
/// 刚建的对话是空的，理所应当；而一条聊过两小时的对话在换了 agent 之后也是
/// 空的 —— 界面分不出来，就只能默不作声地给一块白板。那不是"没有历史"，那
/// 是"有历史但拿不到"，两件事对人的意义完全不同。
///
/// 内部标签，所以线上是一个判别联合：`{ state: "live" }`、
/// `{ state: "unavailable", reason: …, owner: … }`。
#[derive(Debug, Serialize, Type)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum AgentHistory {
    /// 这条对话刚刚建出来，本来就没有经过。
    Fresh,
    /// 这一次只要了一个地址，没问经过。
    ///
    /// 提问和改设置走的就是这一路：它们不需要历史，也就不该为此让 agent 把整段
    /// 对话重放一遍。所以这一格到不了界面 —— 打开一条对话永远要经过。
    Live,
    /// agent 把它装载回来了，`events` 就是它交出来的那一整段。
    Loaded,
    /// 打不开。说清是为什么，以及它在谁手里。
    #[serde(rename_all = "camelCase")]
    Unavailable {
        /// 为什么打不开。
        reason: AgentHistoryLoss,
        /// 持有这条对话的那个 agent；这一列存在之前写下的行没有。
        owner: Option<String>,
    },
}

/// 这一次寻址，要的是什么。
///
/// 两个问题此前挤在一个函数里：「这条对话该发往哪个会话」每一轮提问都要问,
/// 「把它的经过取回来」只有打开的时候才要。挤在一起就只能二选一 —— 为了不让
/// 每一轮提问都付一次重放的代价，打开时也就拿不到经过，于是原生侧改去猜屏幕
/// 上还有没有东西。分开问，两边都对，也没什么可猜的了。
#[derive(Clone, Copy, Debug)]
enum Wanted {
    /// 只要一个能把东西发过去的会话号。
    Address,
    /// 还要这条对话的经过：屏幕上现在什么都没有。
    History,
}

/// 一条对话所持有的活会话，以及装载它时 agent 交回来的东西。
struct Held {
    thread_id: Uuid,
    session_id: String,
    /// 只有刚开出来的会话有：agent 在同一个答复里报了它。
    offered: Option<Vec<ConfigControl>>,
    /// 装载一条旧会话时，agent 用 session/update 重放的那一整段。
    ///
    /// 与上面那格同一条规矩：只有真的开或装载了一条，才有东西可带。只要地址
    /// 的那一路这里是空的 —— 它压根没问。
    events: Vec<Value>,
    /// 上面那格为什么是它现在的样子。
    history: AgentHistory,
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

/// 忘掉一个会话号。
///
/// 与 remember 成对：agent 那侧已经没有它了，这里再认得它就是认得一个
/// 不存在的东西。
fn forget(state: &State<'_, AgentRuntime>, session_id: &str) -> Result<()> {
    let _forgotten = state
        .live
        .lock()
        .map_err(|_poisoned| Error::Internal(POISONED.to_owned()))?
        .remove(session_id);

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
/// 整个模块只有这一条寻址规则，没有兜底。对话持有会话，`attach_session` 是写下
/// 来的地方——但写下来的那一个只在开它的那条连接里有意义：ACP 的会话号随连接
/// 生灭，进程重启之后 agent 不认识它。此前它被当成持久主键直接用于寻址，于是
/// 一条上次运行留下的对话，它的选择器和它的每一轮提问都发往一个早已不存在的
/// 会话：前者是屏幕上那句"会话设置读取失败"，后者是一轮永远不会开始的回答。
///
/// 认不得的那一个不是废号，是一条还在 agent 那侧的会话。ACP 为它准备了
/// `session/load`：号原样交回去，agent 把它重新装载起来，历史因此还在。此前
/// 这里直接重开一条空会话并用它覆盖掉旧号 —— 屏幕上的历史来自本地日志，所以
/// 看起来一切正常，而 agent 手里什么都没有；被覆盖掉的那个号从此也再找不回来。
///
/// 只有 agent 自己在握手时说了它不装载旧会话，才开一条新的。那一刻旧号确实
/// 不再指向任何东西，所以这不是兜底，是另一种事实。
///
/// 两条会话路径都由 agent 在同一个答复里报回整张选择器表，所以第三个字段只在
/// 「这次真的开或装载了一条」时有值：这不是缓存，是省掉一次多余的往返。
///
/// 号本身还要认人。sessionId 活在 agent 自己的命名空间里，B 不认识 A 开的
/// 号：换一个 agent 再点开旧对话，发出去的是一个对面从没见过的名字，回来的
/// 是 UnknownSession。所以持有者跟着号一起存，对不上就根本不装载，这条对话
/// 在新 agent 这里从一条空会话开始。
///
/// 这一刻屏幕上是空的，而且只能是空的：那段历史在原来那个 agent 手里，这一侧
/// 没有副本可拿。空本身不是问题，不作声才是 —— 所以每一条返回路径都带一个
/// `history`，说清这一次的空是"刚建"、"本来就在"，还是"打不开，以及为什么"。
///
/// 会话的工作目录是平台给的答案（state.root），不是进程的当前目录。
async fn session_for(
    state: &State<'_, AgentRuntime>,
    live: &Handle,
    named: &str,
    wanted: Wanted,
) -> Result<Held> {
    let thread_id = conversation(named)?;

    let stored = {
        let shared = shared_store(state)?;
        let store = borrow_store(&shared)?;

        store.thread(thread_id).map_err(persistence)?
    };

    /* 号和持有者分开拿。此前它们被 and_then + filter 折成一个 Option，于是
    "这条对话属于别的 agent"与"这条对话还没有会话"在类型上不可分辨 —— 那正是
    这一路说不出话的原因：折叠丢掉的不是数据，是问句的答案。 */
    let (session_id, owner) = match stored {
        Some(thread) => (thread.session_id, thread.agent_id),
        None => (None, None),
    };

    /* 空的持有者是这一列存在之前写下的行：那时候只装得下一个 agent，所以按
    本次这个算，装载成功时在下面记实。 */
    let mine = owner.as_deref().is_none_or(|id| id == live.agent_id);

    /* 走到下面新开一条时，这里说得出刚才为什么没能装载回来。 */
    let mut lost: Option<AgentHistory> = None;

    if let Some(session_id) = session_id {
        /* 本次连接开出来的号，agent 此刻就认得它。
        它认得，不等于屏幕上还有东西：渲染层可以在连接活着的时候整个重来
        （Ctrl+R、第二个窗口），那一刻它手里一片空白。「有没有经过可看」是
        那一侧的事实，这一侧猜不出来，所以不猜 —— 要经过的那一路照样去装载。 */
        let known = recognised(state, &session_id)?;

        if !mine {
            /* 号发出去只会换回 UnknownSession，所以不发。 */
            lost = Some(AgentHistory::Unavailable {
                reason: AgentHistoryLoss::OtherAgent,
                owner,
            });
        } else if known && matches!(wanted, Wanted::Address) {
            /* 只要一个地址，那就是它，不必惊动 agent。 */
            return Ok(Held {
                thread_id,
                session_id,
                offered: None,
                events: Vec::new(),
                history: AgentHistory::Live,
            });
        } else if live.can_load_session {
            /* 上次运行留下的。号不变，让 agent 把它装载回来。 */
            match live
                .client
                .load_session(session_id.clone(), state.root.clone())
                .await
            {
                Ok(loaded) => {
                    remember(state, &session_id)?;

                    /* 装载成功，这条会话确实是这个 agent 的。空的那一格在这里
                    记实，所以补写只发生一次，不是每次开对话都写一遍。 */
                    {
                        let shared = shared_store(state)?;
                        let store = borrow_store(&shared)?;

                        store
                            .attach_session(thread_id, &session_id, &live.agent_id)
                            .map_err(persistence)?;
                    }

                    return Ok(Held {
                        thread_id,
                        session_id,
                        events: loaded.events,
                        offered: Some(loaded.selectors),
                        history: AgentHistory::Loaded,
                    });
                }
                /* agent 自己也不再留着这条会话了。往下仍然开一条新的，但这一次
                不装作无事发生：拿不到就是拿不到，说出来。 */
                Err(error) => {
                    log::warn!("could not reload the stored session: {error}");

                    /* 号还活着，只是这一次没能把它重放出来。绝不能顺势重开一
                    条：那会把一条正在用的会话丢掉，而人可能还在里面说话。 */
                    if known {
                        return Ok(Held {
                            thread_id,
                            session_id,
                            offered: None,
                            events: Vec::new(),
                            history: AgentHistory::Unavailable {
                                reason: AgentHistoryLoss::Forgotten,
                                owner,
                            },
                        });
                    }

                    lost = Some(AgentHistory::Unavailable {
                        reason: AgentHistoryLoss::Forgotten,
                        owner,
                    });
                }
            }
        } else if known {
            /* 它不装载旧会话，可这一条本来就还在这条连接上：经过取不回来，会话
            得留着。重开一条只会把它也赔进去。 */
            return Ok(Held {
                thread_id,
                session_id,
                offered: None,
                events: Vec::new(),
                history: AgentHistory::Unavailable {
                    reason: AgentHistoryLoss::NotSupported,
                    owner,
                },
            });
        } else {
            /* 它握手时就说了它不做这件事。 */
            lost = Some(AgentHistory::Unavailable {
                reason: AgentHistoryLoss::NotSupported,
                owner,
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
            .attach_session(thread_id, &opened.session_id, &live.agent_id)
            .map_err(persistence)?;
    }

    remember(state, &opened.session_id)?;

    Ok(Held {
        thread_id,
        session_id: opened.session_id,
        offered: Some(opened.selectors),
        events: Vec::new(),
        history: lost.unwrap_or(AgentHistory::Fresh),
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

/// Deletes a conversation, on this side and on the agent's.
///
/// 本地那一份是一行索引，一句 DELETE 就没了：这张表底下已经不挂任何东西。
///
/// 真正的那一份在 agent 手里。它存着这条对话的全文，此前从没有人告诉过它这条
/// 对话被删了 —— 屏幕上没了、对面完整留着，那不是删除，是隐藏。ACP 为此
/// 有 session/delete，而它可不可用由 agent 在握手时自己说。
///
/// 三个前提缺一不可：连接还活着、这条会话确实是这个 agent 的、它声明了这
/// 项能力。都不满足就只删本地那一份 —— 并且不为此去起一个进程：删一条对话
/// 不该是拉起一个 agent 的理由。那种情况下 agent 那份会留到下次它自己清理。
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

    let stored = {
        let shared = shared_store(&state)?;
        let store = borrow_store(&shared)?;

        store.thread(id).map_err(persistence)?
    };

    let live = borrow(&state)?;

    /* 持有者对不上就不发：会话号活在各自 agent 的命名空间里，把 A 的号发给
    B，删的可能是 B 的东西。空的持有者是这一列存在之前写下的行，按本次这个
    算 —— 与 session_for 同一条规矩，不另立一套。 */
    let held = stored.and_then(|thread| {
        let owner = thread.agent_id;

        thread.session_id.filter(|_| {
            live.as_ref().is_some_and(|live| {
                live.can_delete_session
                    && owner.as_deref().is_none_or(|agent| agent == live.agent_id)
            })
        })
    });

    if let (Some(live), Some(session_id)) = (live, held) {
        if let Err(error) = live.client.delete_session(session_id.clone()).await {
            /* agent 拒绝，或者它自己也早就不留着这条会话了。本地这一份仍然
            要删：用户按的是删除，不是「如果 agent 同意就删除」。 */
            log::warn!("could not delete the session on the agent: {error}");
        }

        forget(&state, &session_id)?;
    }

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
