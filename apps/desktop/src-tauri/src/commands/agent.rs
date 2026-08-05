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
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use poietica_agent_persistence_native::{AgentStore, StoreError, ThreadAttachment, TitleSource};
use poietica_agent_runtime_native::{
    ACP_UPDATE, AcpError, AgentClient, AgentConnection, AgentSpawn, ConfigControl, ConfigPurpose,
    FrameSink, PermissionDesk, PromptImage, RecordedEvent, Refusal, RunSlot, connect,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, async_runtime};
use uuid::Uuid;

use crate::asset_protocol::{
    AssetProtocolError, AssetProtocolRegistry, AssetSessionSnapshotEntry, asset_protocol_url,
};
use crate::attachments::{blob_path, forget_blob, store_bytes};
use crate::commands::agent_config::launch_env;
use crate::error::{Error, IpcError, Result};
use crate::paths::{agent_database, attachments_root};

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

/// 一拍的宽度：帧攒到这么久，就交货一次。
///
/// 六十赫兹的屏幕上，比这更密的投递没有人看得见 —— 收帧的那一侧也正是按这个
/// 节拍醒来的（见 transcript-store.ts 的 `#paint`）。
const FRAME_INTERVAL: Duration = Duration::from_millis(16);

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

/// 一张图大到账本里那一格装不下。
const IMAGE_TOO_LARGE: &str = "an attachment is too large";

/// 那两个令牌在交付注册表里指不到东西。
///
/// 到不了才是常态：令牌是输入框刚刚从原生侧拿到的，中间没有人关过那条会话。
/// 真的到了，说明这一句带的图已经不在了 —— 那就不该假装它还在，静默少发一张
/// 图比失败更坏，因为屏幕上什么都不会说。
const NO_SUCH_ASSET: &str = "an attachment is no longer available";

/// 一句话里的图片多到序号装不下。实际到不了，但转换要有个说法。
const TOO_MANY_IMAGES: &str = "too many attachments in one message";

/// 账本里的一个计数，大到线上那一格装不下。
///
/// 同样到不了：四十亿条用户消息，或者一句话里四十亿张图。但静默截断是
/// 不能接受的，所以它有一个说法。
const COUNT_TOO_LARGE: &str = "a stored count does not fit the wire";

/// 一句话只有图片时，这条对话叫什么。
///
/// 标题取自第一句话，而第一句话可以没有字。此前那一行直接 take 一个空串，
/// 于是列表里出现一条没有名字的对话。
const IMAGE_OPENER: &str = "[图片]";

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
    /// 这条连接锚会话的记录槽。
    ///
    /// 它的语义是一条会话：driver 建立连接时把它 adopt 到锚会话名下，别的会话
    /// 由册子各开一个。此前它挂在 AgentRuntime 上，也就是说换一条连接要复用
    /// 上一条连接的槽。
    slot: RunSlot,
    /// 这条连接的权限台。
    ///
    /// request_id 由 agent 自己发，两个 agent 的号不可通约：共用一张桌子，一个
    /// 答案就可能落到另一个 agent 的问题上。
    desk: PermissionDesk,
    /// 这条连接开出来的会话号。
    ///
    /// ACP 的 sessionId 只在一条连接内有意义，而且活在这个 agent 自己的命名空间
    /// 里：进程重启之后它不认识上一次的号，另一个 agent 从来不认识它。
    known: Arc<Mutex<HashSet<String>>>,
}

/// 这个进程活多久就活多久的那些东西：库、附件、根目录，以及此刻那一条连接。
///
/// 连接自己的东西不在这里 —— 记录槽、权限台、它开出来的会话号，寿命都是一条
/// 连接。它们此前是这个结构的字段，于是全进程只有一份，而第二个 agent 在结构
/// 上就放不进来。
#[derive(Debug)]
pub struct AgentRuntime {
    database: PathBuf,
    /// 附件字节的根。与库文件同一个时刻解析：两者都是布局，不是某条命令的参数。
    attachments: PathBuf,
    root: PathBuf,
    connection: Mutex<Option<Connection>>,
    /// 起一条连接这件事的排队处。
    ///
    /// 上面那把锁护的是"连接现在是谁"，护不住"谁正在把它建起来"：建连接要
    /// 起进程、要等握手，中间全是 await，而一把 std 的锁不能跨 await 持有。
    /// 于是此前的双重检查发生在握手之后 —— 检查过了，钱已经花完了。
    ///
    /// 这道闸把昂贵的那一段圈进临界区：排在后面的人在闸前等，等到的是前面
    /// 那位建好的连接，而不是自己再起一个进程。它自己不记任何状态，所以
    /// `agent_shutdown` 之后重新起一条连接照样成立 —— 这是它比 `OnceCell` 合适
    /// 的地方，后者一次成型，没有回头路。
    starting: tokio::sync::Mutex<()>,
    /// The one connection to the index, opened on first use.
    ///
    /// Every command used to open one of its own: a full migrate, all of
    /// it again for something as ordinary as refreshing the sidebar. The
    /// single writer this file claims to have had never actually existed.
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
            attachments: attachments_root(handle)?,
            root,
            connection: Mutex::new(None),
            starting: tokio::sync::Mutex::new(()),
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

/// 一张随这一句话送出去的图片，按它在交付注册表里的位置点名。
///
/// 字节不再跨 IPC。它们在用户把文件放进输入框的那一刻就已经在原生侧了
/// （见 commands/asset.rs 的 asset_import 与 asset_upload），这里交回来的
/// 只是取得它的两个令牌 —— 一次提问因此不再搬运任何字节，无论那张图多大。
///
/// 手写的 Debug 也随之没有了：这个结构现在一共两个短字符串，一整个请求打
/// 进日志也就是两行令牌。此前它必须手写，因为默认的 Debug 会把十六兆的
/// base64 原样吐进日志文件。
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptAsset {
    /// 这张图挂在哪条资产会话下（输入框那一条）。
    pub session_token: String,
    /// 它在那条会话里的令牌，也就是内容摘要。
    pub asset_token: String,
}

/// A prompt, and how to start the agent if it is not running yet.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptRequest {
    /// What the user typed.
    pub text: String,
    /// 这一句带的图片，按它们在交付注册表里的位置点名。
    ///
    /// 与 text 是同一句话的两半，所以判空要一起判：只挑了图、没打字是一句
    /// 完整的话。
    pub assets: Vec<AgentPromptAsset>,
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
    /// 这一句里的图片在 webview 里的地址，顺序与用户挑的一致。
    ///
    /// 与重开这条对话时交回的那些是同一种东西（见 AgentThreadAttachment）：
    /// 字节落盘的同一趟里就铺进了同一条交付会话，所以"刚发出去的图"和"昨天
    /// 发过的图"在渲染层那边不再是两种写法。此前那一侧自己拼 data: URL ——
    /// 一张十六兆的图会在 JS 堆上留下一份二十一兆的字符串，活到这条对话被
    /// 关掉为止；而那条路不经过协议，于是协议这条路坏了很久都没人发现。
    pub images: Vec<String>,
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
    assets: State<'_, AssetProtocolRegistry>,
    request: AgentPromptRequest,
) -> AgentCommandResult<AgentPromptResult> {
    let text = request.text.trim().to_owned();
    let attached = request.assets;

    /* 空的是这一句话，不是这一格。只挑了图、没打字，仍然是一句完整的话 ——
    此前这里只看 text，那种消息就死在这一行上，屏幕上是一句「请求参数无效」。 */
    if text.is_empty() && attached.is_empty() {
        return Err(Error::Validation("the prompt is empty".to_owned()).into());
    }

    /* 这里不再验类型、不再验大小。字节进注册表的那一刻就已经验过：内容类型
    由文件头嗅出来（asset.rs 的 sniff，不看扩展名），交付得了才收得下
    （validate_content_type），单张上限由 MAX_ASSET_BYTES 卡。同一件事只判一次，
    而且判在字节所在的那一侧 —— 此前门口这三条判的是渲染层自己报的 MIME 与一个
    base64 字符串的长度，两样都不是事实本身。

    这一路唯一还会失败的事，是那两个令牌指不到东西，由 keep_bytes 说出来。 */

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
    //
    // 后面每一轮也走同一行。名字不会被它们改掉（record_prompt 的 CASE 只在
    // 还没有名字时才写），但活动时间会 —— 那正是这一行每轮都要跑的理由。
    let opener: String = if text.is_empty() {
        IMAGE_OPENER.to_owned()
    } else {
        text.chars().take(TITLE_CHARS).collect()
    };

    // 一句话记两件事：这条对话刚刚有活动，以及 —— 只有第一次 —— 它叫什么。
    // 两个条件写在同一条语句里（见 record_prompt），所以这里每一轮都调，不
    // 在这一侧判「是不是第一句」：那个判据的权威在库里，而它已经在守着了。
    //
    // 库操作只有一条路。它在阻塞线程池上，所以这一次写不会停住这个运行时上
    // 别的东西 —— 包括 ACP driver 的 future，它就在这里 spawn 的。
    let turn = on_store(&state, move |store| {
        store.record_prompt(thread_id, &opener).map_err(persistence)
    })
    .await?;

    /* 先落盘、铺进交付会话，再记账，最后才上路。顺序见 attachments.rs 的模块
    头：反过来会留下一条指着不存在字节的账，而那种残留不会自愈。 */
    let Kept {
        carried,
        ledger,
        urls,
    } = keep_bytes(
        state.attachments.clone(),
        assets.inner().clone(),
        thread_id.to_string(),
        attached,
        turn,
    )
    .await?;

    for attachment in ledger {
        on_store(&state, move |store| {
            store
                .remember_attachment(thread_id, &attachment)
                .map_err(persistence)
        })
        .await?;
    }

    let frames = batched(app);

    let answer = session
        .client
        .prompt(addressed.clone(), text, carried, frames)
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
        images: urls,
    })
}

/// 一句话里的图片落定之后的三份东西。
///
/// 同一批字节，三个去处，一次解码：协议要 base64 那一份，账本要摘要与位置，
/// 屏幕要一条取得回它的地址。第三份此前不存在，于是渲染层自己拼了一条 data:
/// URL —— 同一张图在这个程序里因此有两种写法，重启前后各一种，而只有其中
/// 一种走过协议。
struct Kept {
    /// 原样交给协议的那一份。
    carried: Vec<PromptImage>,
    /// 记进账本的那些行。
    ledger: Vec<ThreadAttachment>,
    /// 屏幕上指向它们的地址，顺序与用户挑的一致。
    urls: Vec<String>,
}

/// 这条对话的交付会话，没有就开一个。
///
/// 注册表用 DuplicateAsset 表示"这条会话已经在了"，而同一条对话上的第二句话
/// 带图时它必然已经开着 —— 那不是错误，是常态。
fn opened_session(assets: &AssetProtocolRegistry, session: &str) -> Result<()> {
    match assets.open_session(session) {
        Ok(()) | Err(AssetProtocolError::DuplicateAsset) => Ok(()),
        Err(error) => Err(asset(error)),
    }
}

/// 一句话带的图片：落盘、过继进这条对话的交付会话，再交还给协议。
///
/// 字节从输入框那条资产会话搬过来，搬的是 Arc 不是内存（见 adopt）。它们在
/// 用户放手的那一刻就已经在这个进程里了，所以这个函数不再解码任何东西 ——
/// 此前它的第一件事是 `BASE64.decode`，而那份 base64 是渲染层先把文件读进
/// webview、编码、跨 IPC 送过来的：一次读、一次编码、一次比原文大三分之一的
/// 传输、一次解码，四份代价，只为把本机的一个文件交给本机的一个进程。
///
/// 编码没有消失，它换了一侧：ACP 的 image content block 只认 base64，而 agent
/// 是另一个进程。现在它发生在字节所在的这一侧，不再往返。
///
/// 整段仍在阻塞执行器上。落盘、SHA-256 与 base64 编码都要过一遍全部字节，
/// 单张最大三十二兆，而这段代码一个 await 都没有 —— 与 commands/asset.rs 把
/// 摘要挪走是同一条判据。
///
/// 账本行仍然不在这里写：那要拿库的锁，而这里拿的是文件系统。一个函数一件事。
async fn keep_bytes(
    root: PathBuf,
    assets: AssetProtocolRegistry,
    session: String,
    attached: Vec<AgentPromptAsset>,
    turn: i64,
) -> Result<Kept> {
    if attached.is_empty() {
        return Ok(Kept {
            carried: Vec::new(),
            ledger: Vec::new(),
            urls: Vec::new(),
        });
    }

    async_runtime::spawn_blocking(move || {
        opened_session(&assets, &session)?;

        let mut carried = Vec::with_capacity(attached.len());
        let mut ledger = Vec::with_capacity(attached.len());
        let mut urls = Vec::with_capacity(attached.len());

        for (ordinal, reference) in attached.into_iter().enumerate() {
            /* 取不到就不发。这一句带的图已经不在了，而静默少发一张比失败更坏：
            对面收到一句没有附件的话，屏幕上什么都不会说。 */
            let (mime, bytes) = assets
                .adopt(&reference.session_token, &reference.asset_token, &session)
                .map_err(asset)?
                .ok_or_else(|| Error::NotFound(NO_SUCH_ASSET.to_owned()))?;

            let blob = store_bytes(&root, &bytes)?;

            let data = BASE64.encode(bytes.as_slice());

            urls.push(asset_protocol_url(&session, &blob.hash).map_err(asset)?);

            ledger.push(ThreadAttachment {
                hash: blob.hash,
                turn,
                ordinal: i64::try_from(ordinal)
                    .map_err(|_overflow| Error::Internal(TOO_MANY_IMAGES.to_owned()))?,
                mime: mime.clone(),
                byte_size: i64::try_from(blob.byte_size)
                    .map_err(|_overflow| Error::Validation(IMAGE_TOO_LARGE.to_owned()))?,
            });

            carried.push(PromptImage {
                data,
                mime_type: mime,
            });
        }

        Ok(Kept {
            carried,
            ledger,
            urls,
        })
    })
    .await
    .map_err(|_dropped| Error::Internal(NO_READ.to_owned()))?
}

/// 帧攒着走，一拍一趟。
///
/// 每一帧一次 emit，就是每一个 token 一次 `RecordedEvent` 全量序列化、一次跨
/// 进程投递、一次 webview 事件派发；一段长回答几千趟。而收帧的那一侧本来就只
/// 按屏幕的节拍看一眼，所以投递的频率此前绑在 token 速率上，消费的频率绑在屏
/// 幕上 —— 两条时钟不同源，中间那一段必然是白付的，而且 agent 越快付得越多。
///
/// 这里让前者服从后者：一拍之内的帧攒成一批，一次上线。
///
/// 不需要定时器，也就没有第二条时间线要管。「一拍之内不会再有下一帧」的处境
/// 只有两种，两种都不是流：一轮的最后一帧必然是 `run_finished` 或 `run_failed`，
/// 而权限请求之后 agent 就闭嘴等人答话。所以流以外的每一种帧都立刻发，连同
/// 它前面攒着的那些，顺序原样 —— 攒着的批不可能卡在谁的手里。
fn batched(app: AppHandle) -> FrameSink {
    let mut held: Vec<RecordedEvent> = Vec::new();
    let mut sent = Instant::now();

    Box::new(move |event: &RecordedEvent| {
        /* 判别式由帧自己说，这一侧不另立一套分类。 */
        let streaming = event.frame.kind() == ACP_UPDATE;
        let now = Instant::now();

        held.push(event.clone());

        if streaming && now.duration_since(sent) < FRAME_INTERVAL {
            return;
        }

        sent = now;

        // 渲染层没在听不是错：这条对话下次打开时，历史由持有它的 agent
        // 随 agent_open_thread 一起交回来。
        let _ignored = app.emit(AGENT_EVENT, &held);

        held.clear();
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
    /* 桌子归连接：一个答案只可能是这条连接问出来的那个问题的答案，而
    request_id 活在 agent 自己的命名空间里 —— 没有连接就没有问题可答。 */
    let live = borrow(&state)?.ok_or_else(|| Error::NotFound(NO_SESSION.to_owned()))?;

    // Every failure here means the same thing to the interface: that answer no
    // longer applies to anything. The detail stays on this side of the wire.
    live.desk
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
/// 这条对应关系在打开这条对话时就写进了库（`attach_session`），提问走的也是它。
/// 此前这里点名的是一个轮次号，为它在内存里另养了一张 runId → sessionId 的表，
/// 一轮开始时写、结束时删：那张表回答的问题，库里本来就有答案。
///
/// 只读寻址，不惊动 agent。查不到就是没有什么可停的 —— 走 `session_for` 会为一条
/// 还没开过口的对话新开一个会话，那是纯副作用。
///
/// 它是 async 的，因为它要读一次库。同步命令跑在主线程上，而一次库读可能要等
/// 写锁，最长等满 `DEFAULT_BUSY_TIMEOUT`，窗口会在那段时间里停止应答
/// （见 `on_store`）。
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
    if !recognised(&live, &addressed)? {
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
    retire(lock(&state.connection)?.take());

    Ok(())
}

/// 让一条连接干净地退场。
///
/// 显式退出与换 agent 是同一件事的两个理由，所以它只写一遍：进程要走、槽里
/// 那位听众要收走、桌上再没有人会来回答、它开出来的会话号也不再指向任何东西。
///
/// 一轮在飞时退场，driver 的 future 被丢掉，那一轮的 Settled::Turn 永远走不完，
/// 于是 RunSlot::take 永远不会被调用。槽现在随连接一起走，所以收不干净只影响
/// 这一条已经作废的连接 —— 此前它是全进程唯一的那一份，一次这样的退出会让
/// 下一条连接的第一轮撞上 Refusal::Busy，而屏幕上那句话答的是另一个问题。
fn retire(taken: Option<Connection>) {
    let Some(gone) = taken else {
        return;
    };

    // The process is going away either way, so a driver that already
    // stopped is not an error worth reporting.
    let _ignored = gone.client.shutdown();

    /* 拿出来就丢掉。RunSlot::take 的文档写的是把这一位交回去、好让它自己
    收尾，而丢掉正是让它收尾。 */
    let _abandoned = gone.slot.take();

    gone.desk.clear();

    if let Ok(mut known) = gone.known.lock() {
        known.clear();
    }
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
    /// 这条连接的权限台。
    desk: PermissionDesk,
    /// 这条连接认得的会话号。
    known: Arc<Mutex<HashSet<String>>>,
}

/// Returns the running session, starting one if there is none.
async fn ensure_session(
    app: &AppHandle,
    state: &State<'_, AgentRuntime>,
    launch: AgentLaunch,
    cwd: Option<String>,
) -> Result<Handle> {
    /* 起哪个 agent 是这个函数的第一件事，因为下面每一次「连接已经在了」都要
    拿它来问。此前它在函数中段才被解构出来，于是上面那两次检查只问了有没有
    连接 —— 换了 agent 之后，这一句话照旧发给上一个进程。 */
    let AgentLaunch {
        agent_id,
        program,
        args,
    } = launch;

    if let Some(live) = borrow(state)?
        && live.agent_id == agent_id
    {
        return Ok(live);
    }

    /* 闸前的那一次检查是快路：连接已经在了就不必排队。下面这一段要起进程、
    要等握手，两件都很贵，所以它们在闸里边做。 */
    let _gate = state.starting.lock().await;

    /* 排在前面那位可能刚好把连接建起来了。这一次的"没有"是可信的：写
    state.connection 的地方只有这个函数，而这一刻拿着闸的人只有一个。 */
    if let Some(live) = borrow(state)? {
        if live.agent_id == agent_id {
            return Ok(live);
        }

        /* 换 agent：上一条连接先干净地退场，再起新的。两个 agent 同时常驻是
        下一刀的事（那要先让库里那一列的持有者补实）；而把 B 的话发给 A、并
        且记成 A 的，今天就是错的。 */
        retire(lock(&state.connection)?.take());
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
    /* 槽、桌子和会话号集合在这里出生，随这条连接一起活。此前它们是
    AgentRuntime 的字段：全进程一个槽、一张桌子、一份号，而它们的语义分别是
    一条会话、一条连接、一条连接。 */
    let slot = RunSlot::new();
    let desk = PermissionDesk::new();
    let known = Arc::new(Mutex::new(HashSet::new()));

    let AgentConnection {
        client,
        handshake,
        driver,
        reports,
        book: _,
    } = connect(spawn, slot.clone(), desk.clone()).map_err(translate)?;

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

    /* 没有第二个人可以到这里，所以也没有谁需要认输：闸还在手里，而写
    这把锁的地方整个模块只有这一处。此前这里有一条"输家把自己起的进程还
    回去"的分支，它记的是一笔已经花掉的账 —— 两个人各起了一个 agent 进程、
    各做了一次握手，然后杀掉一个。闸把那笔账取消了，分支随之不可达。 */
    *lock(&state.connection)? = Some(Connection {
        client: client.clone(),
        agent_id: agent_id.clone(),
        anchor: session_id.clone(),
        can_load_session,
        can_delete_session,
        slot: slot.clone(),
        desk: desk.clone(),
        known: Arc::clone(&known),
    });

    let live = Handle {
        client,
        agent_id,
        anchor: session_id.clone(),
        can_load_session,
        can_delete_session,
        desk,
        known,
    };

    /* 连接建立时自带的会话号：没有对话持有它，但寻址按号认人，所以要认得。 */
    remember(&live, &session_id)?;

    Ok(live)
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
        desk: live.desk.clone(),
        known: Arc::clone(&live.known),
    }))
}

/// The one connection, opened the first time anything needs it.
///
/// Not at boot: opening it runs the migrations, and a launch that never
/// opens the assistant should not pay for that. Once, though, and not once
/// per command.
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
/// A command that is not `async` runs on the main thread, and a read of the
/// index may wait on the write lock for as long as `DEFAULT_BUSY_TIMEOUT`
/// before a single row comes back. Put that on the main thread and the window stops
/// answering: the sidebar does not highlight, the click does not land, and
/// the conversation looks broken rather than slow.
///
/// The two halves are separate on purpose. Taking the share needs the
/// managed state, which is borrowed; running the work needs `'static`. So
/// the handle is taken here and the statement is handed to the pool.
async fn on_store<T, F>(state: &State<'_, AgentRuntime>, work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&mut AgentStore) -> Result<T> + Send + 'static,
{
    let shared = shared_store(state)?;

    async_runtime::spawn_blocking(move || {
        let mut store = borrow_store(&shared)?;

        work(&mut store)
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
    /// 它是在哪个工作目录里开的。列表按它分组；空表示默认那一个工作区
    /// （thread-order.ts 的 DEFAULT_WORKSPACE_ID 那一段说明了为什么）。
    pub workspace_root: Option<String>,
}

/// 这条对话挂着的一张附件，以及它该出现在哪里。
///
/// URL 由这一侧拼好交出去（`asset_protocol_url`），渲染层不自己拼：它的形状
/// 是协议的事，多一个人知道就多一处会漂移。
///
/// 位置由「第几条用户消息、这条消息里的第几张」两个数给出，而不是消息 id ——
/// 这个程序不存对话内容，历史由 agent 交还，那份历史里的 id 不归我们发。
/// 能由两侧各自数出同一个答案的，只有序号（见迁移 0010 与 0011）。
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentThreadAttachment {
    /// `poietica-asset://asset/{thread}/{sha256}`，可以直接进 img 的 src。
    pub url: String,
    /// 这是这条对话里第几条用户消息，从 0 数起。
    ///
    /// 序号不为负，也不会大到 32 位装不下，所以线上就是 u32 —— 库里那一列
    /// 是 i64 只因为 SQLite 的整数天生是 i64，那是存储的宽度，不是协议的。
    /// specta 拒绝导出 i64 正是在守这条界线：JS 的 number 只精确到 2^53。
    pub turn: u32,
    /// 那条消息里的第几张，从 0 数起。
    pub ordinal: u32,
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
    /// 这条对话挂着的图片，字节已经装回交付注册表，URL 拿去就能用。
    ///
    /// 它不来自 agent。上面那段经过是 agent 交还的，而图片是这台机器上用户
    /// 自己的文件：agent 收到的是一份 base64 副本，它没有义务交还，多数 CLI
    /// 也确实不交还 —— 所以这一格由本地账本回答（见 persistence 的
    /// attachments.rs）。
    pub attachments: Vec<AgentThreadAttachment>,
    /// 这条对话至今问过多少句话。
    ///
    /// 上面那些附件的 turn 是照着它量的,而且是从末尾量起:计数为 N,就表示
    /// turn 盖住的是最后 N 条用户消息。渲染层拿它去减自己数出来的条数,得到
    /// 的差就是要跳过的那一段前史(0011 之前的那些话)。
    ///
    /// 少了它,认领方就只能假定「第 0 轮就是第一条消息」—— 那对每一条迁移
    /// 之前就存在的对话都是错的。
    ///
    /// 与上面那两格同一个宽度，同一个理由。
    pub prompts: u32,
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
    assets: State<'_, AssetProtocolRegistry>,
    request: AgentOpenThreadRequest,
) -> AgentCommandResult<AgentOpenedThread> {
    let asked = request.cwd.clone();
    let live = ensure_session(&app, &state, request.launch, request.cwd).await?;

    let named = if let Some(given) = request.thread_id {
        given
    } else {
        /* 新建的这一条属于此刻这个工作目录，而且从此属于它：之后每一次为这条
        对话开会话都照这一行，不照「渲染层此刻选的那个」。 */
        on_store(&state, move |store| {
            store
                .create_thread(FALLBACK_THREAD_TITLE, asked.as_deref())
                .map(|id| id.to_string())
                .map_err(persistence)
        })
        .await?
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
    let thread = on_store(&state, move |store| {
        store
            .thread(thread_id)
            .map_err(persistence)?
            .map(retitle)
            .ok_or_else(|| Error::Internal(NO_THREAD.to_owned()))
    })
    .await?;

    let attachments = deliver_attachments(&state, &assets, thread_id).await?;

    /* 单独一次读,不并进上面那趟:一个是「有哪些图」,一个是「轮次号从哪儿
    起算」,两个问题各自回答得清楚,合成一趟只会让那个函数多一个出参。走的是
    同一条 on_store、同一把锁、同一个 prepare_cached。 */
    let prompts = on_store(&state, move |store| {
        store.prompt_count(thread_id).map_err(persistence)
    })
    .await?;

    let prompts = counted(prompts)?;

    Ok(AgentOpenedThread {
        thread,
        selectors: offered.into_iter().map(restate).collect(),
        events,
        history,
        attachments,
        prompts,
    })
}

/// 把这条对话挂着的字节装回交付注册表，并交出可以直接用的 URL。
///
/// 交付会话的令牌是**对话**，不是 ACP 的 sessionId：后者随连接生灭，而这些
/// URL 要在重启之后仍然指向同一张图。
///
/// # Errors
///
/// 账本读不出、字节读不动（缺失除外）、或注册表拒绝这一批时返回错误。
async fn deliver_attachments(
    state: &State<'_, AgentRuntime>,
    assets: &State<'_, AssetProtocolRegistry>,
    thread_id: Uuid,
) -> Result<Vec<AgentThreadAttachment>> {
    let ledger = on_store(state, move |store| {
        store.attachments_of(thread_id).map_err(persistence)
    })
    .await?;

    let session = thread_id.to_string();

    /* 账本空了也要走完这一趟：上一次铺下的那一份得撤掉，而"撤掉"现在就是
    "换成一条空的"。此前这里提前 return，撤除靠的是函数开头那一次单独的
    remove_session —— 两条返回路径,两处撤除时机,而它们必须永远一致。 */

    /* 按摘要去重。同一张图挂在两轮上是常事 —— 内容寻址的全部意义就在这里 ——
    而 restore_session 收到两个相同的摘要会把整批拒掉。账本给的是链接行，不是
    字节，两者的条数本来就不相等。 */
    let mut seen = HashSet::new();
    let mut wanted = Vec::new();

    for attachment in &ledger {
        if seen.insert(attachment.hash.clone()) {
            wanted.push((attachment.hash.clone(), attachment.mime.clone()));
        }
    }

    let root = state.attachments.clone();

    let entries = async_runtime::spawn_blocking(move || {
        let mut entries = Vec::with_capacity(wanted.len());

        for (hash, mime) in wanted {
            let path = blob_path(&root, &hash)?;

            let bytes = match std::fs::read(&path) {
                Ok(bytes) => bytes,
                /* 少一张图不该让整条对话打不开。人可以手动清过那个目录，同步
                软件也可能吞掉文件；那时候正确的行为是显示其余的，而不是把这
                条对话变成一个打不开的东西。无主的账下一次回收会扫掉。 */
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    log::warn!("an attachment's bytes are missing: {hash}");
                    continue;
                }
                Err(error) => return Err(Error::Io(error)),
            };

            /* verify，不是 from_verified_container：后者的契约要求调用方已经
            在本进程里对这批字节做过摘要，而这些字节刚从磁盘读上来，没有人验过。
            文件名就是摘要，所以这一次哈希同时就是一次完整性检查。 */
            match AssetSessionSnapshotEntry::verify(hash.clone(), mime, Arc::new(bytes)) {
                Ok(entry) => entries.push(entry),
                /* 门口现在挡着这类附件（见 agent_prompt），但迁移之前存下的那些
                还在账本里。一张交付不了的图此前会让整条对话打不开 —— 与上面缺
                字节那一支同一条规矩：显示其余的，把这一张记进日志。 */
                Err(error) => {
                    log::warn!("an attachment cannot be delivered: {hash} {error:?}");
                }
            }
        }

        Ok::<_, Error>(entries)
    })
    .await
    .map_err(|_dropped| Error::Internal(NO_READ.to_owned()))??;

    /* 真正铺进去的那些。缺字节的那几张不在里面，所以也不该出现在答复里 ——
    交出一条取不到东西的 URL，屏幕上就是一个破图标。 */
    let delivered = entries
        .iter()
        .map(|entry| entry.content_hash().to_owned())
        .collect::<HashSet<_>>();

    /* 撤旧与铺新在注册表的同一次写锁里完成。此前是"函数开头 remove_session、
    函数末尾 restore_session"，中间隔着一次库读和一整趟磁盘读：那段时间这条
    会话在注册表里不存在，而这条命令的重入是常态（Ctrl+R、第二个窗口）。旧
    页面上还挂着的 <img> 在那一瞬取到 404，协议这一侧没有重试，破图标就留下
    来了。 */
    assets.replace_session(&session, entries).map_err(asset)?;

    ledger
        .into_iter()
        .filter(|attachment| delivered.contains(&attachment.hash))
        .map(|attachment| {
            Ok(AgentThreadAttachment {
                url: asset_protocol_url(&session, &attachment.hash).map_err(asset)?,
                turn: counted(attachment.turn)?,
                ordinal: counted(attachment.ordinal)?,
            })
        })
        .collect()
}

/// 库里的一个计数，缩成线上那一格。
///
/// 只有这一处做这件事。SQLite 交回来的一律是 i64，而这份 IPC 面上没有
/// 任何一个 64 位整数 —— 边界在这里，不在别处。
fn counted(value: i64) -> Result<u32> {
    u32::try_from(value).map_err(|_overflow| Error::Internal(COUNT_TOO_LARGE.to_owned()))
}

/// 交付失败，说给屏幕听的那一句。
///
/// 与 translate 同一条规矩：细节进日志，上屏的是固定文案。这里的细节是注册表
/// 的内部判定（预算、令牌形状、摘要不符），对屏幕前的人没有一句是可行动的。
fn asset(error: AssetProtocolError) -> Error {
    log::error!("an attachment could not be delivered: {error:?}");

    Error::Asset("an attachment could not be delivered".to_owned())
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
        workspace_root: thread.workspace_root,
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
    /// `UnknownSession` —— 所以这里根本不发。
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
fn remember(live: &Handle, session_id: &str) -> Result<()> {
    live.known
        .lock()
        .map_err(|_poisoned| Error::Internal(POISONED.to_owned()))?
        .insert(session_id.to_owned());

    Ok(())
}

/// 忘掉一个会话号。
///
/// 与 remember 成对：agent 那侧已经没有它了，这里再认得它就是认得一个
/// 不存在的东西。
fn forget(live: &Handle, session_id: &str) -> Result<()> {
    let _forgotten = live
        .known
        .lock()
        .map_err(|_poisoned| Error::Internal(POISONED.to_owned()))?
        .remove(session_id);

    Ok(())
}

/// 本次连接是否认得这个会话号。
fn recognised(live: &Handle, session_id: &str) -> Result<bool> {
    Ok(live
        .known
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
/// 会话的工作目录由这条对话自己那一行说了算（迁移 0013 的 workspace_root）。
/// 空的才回落到平台给的那个 home —— 那是迁移之前写下的行，那时候只有一个工作
/// 目录，所以回落是一条事实，不是兜底。取进程的当前目录回答的是另一个问题：
/// 开发运行时它是 Rust 的构建目录。
async fn session_for(
    state: &State<'_, AgentRuntime>,
    live: &Handle,
    named: &str,
    wanted: Wanted,
) -> Result<Held> {
    let thread_id = conversation(named)?;

    let stored = on_store(state, move |store| {
        store.thread(thread_id).map_err(persistence)
    })
    .await?;

    /* 号和持有者分开拿。此前它们被 and_then + filter 折成一个 Option，于是
    "这条对话属于别的 agent"与"这条对话还没有会话"在类型上不可分辨 —— 那正是
    这一路说不出话的原因：折叠丢掉的不是数据，是问句的答案。 */
    let (session_id, owner, recorded) = match stored {
        Some(thread) => (thread.session_id, thread.agent_id, thread.workspace_root),
        None => (None, None, None),
    };

    /* 目录是对话的属性，不是这一刻的选择：从项目 A 的一条旧对话里说话，不该
    跑到项目 B 的目录里去。此前这两处都写死 state.root，也就是家目录 —— 于是
    人选的那个工作目录只影响起进程那一次，agent 实际在哪里读写与它无关。 */
    let workspace = match recorded {
        Some(path) => PathBuf::from(path),
        None => state.root.clone(),
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
        let known = recognised(live, &session_id)?;

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
                .load_session(session_id.clone(), workspace.clone())
                .await
            {
                Ok(loaded) => {
                    remember(live, &session_id)?;

                    /* 装载成功，这条会话确实是这个 agent 的。空的那一格在这里
                    记实，所以补写只发生一次，不是每次开对话都写一遍。 */
                    {
                        // 交给线程池的活得自己拥有它读的东西：号下面还要用，
                        // 而 agent_id 借的是调用者的 Handle。
                        let attached = session_id.clone();
                        let owner = live.agent_id.clone();

                        on_store(state, move |store| {
                            store
                                .attach_session(thread_id, &attached, &owner)
                                .map_err(persistence)
                        })
                        .await?;
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
        .new_session(workspace)
        .await
        .map_err(translate)?;

    {
        let attached = opened.session_id.clone();
        let owner = live.agent_id.clone();

        on_store(state, move |store| {
            store
                .attach_session(thread_id, &attached, &owner)
                .map_err(persistence)
        })
        .await?;
    }

    remember(live, &opened.session_id)?;

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

    let stored = on_store(&state, move |store| store.thread(id).map_err(persistence)).await?;

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

        forget(&live, &session_id)?;
    }

    on_store(&state, move |store| {
        store.delete_thread(id).map_err(persistence)
    })
    .await?;

    /* 删对话正是垃圾产生的时刻，所以回收就在这里，不另立一条定时清理。
    行先删、文件后删：反过来崩在中间会留下一条指着空文件的账，而这一个
    方向留下的孤儿文件下一次删除时会被再扫出来。 */
    let orphans = on_store(&state, |store| {
        let orphans = store.unreferenced_attachments().map_err(persistence)?;

        for hash in &orphans {
            store.forget_attachment(hash).map_err(persistence)?;
        }

        Ok(orphans)
    })
    .await?;

    /* 不 await：删几个文件不该让「删除对话」这个动作在屏幕上多停一会儿。 */
    let root = state.attachments.clone();

    let _detached = async_runtime::spawn_blocking(move || {
        for hash in orphans {
            if let Err(error) = forget_blob(&root, &hash) {
                log::warn!("could not remove an unreferenced attachment: {error}");
            }
        }
    });

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
