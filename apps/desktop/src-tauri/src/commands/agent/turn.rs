//! 一个轮次：发起、停止、回答权限、收摊。
//!
//! 帧不逐条发给界面 —— 攒一拍再交货，否则渲染进程被事件淹掉。

use std::time::Instant;
use poietica_agent_runtime_native::{ACP_UPDATE, FrameSink, RecordedEvent};
use tauri::{AppHandle, Emitter, State, async_runtime};
use crate::asset_protocol::AssetProtocolRegistry;
use crate::error::Error;

use super::{
    AGENT_EVENT,
    AgentCommandResult,
    FRAME_INTERVAL,
    IMAGE_OPENER,
    NOTHING_TO_STOP,
    NO_CONVERSATION,
    NO_SESSION,
    TITLE_CHARS,
};
use super::addressing::{Wanted, session_for};
use super::attachment::{Kept, keep_bytes};
use super::dto::{
    AgentCancelRequest,
    AgentPromptRequest,
    AgentPromptResult,
    AgentResolvePermissionRequest,
};
use super::failure::{fn, translate};
use super::runtime::{AgentRuntime, borrow, ensure_session, lock, retire};
use super::store::{conversation, on_store, persistence};

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

    /* 本次连接认不得的号是上次运行留下的：那条会话上没有这一侧发起的轮次。
    判据取自驱动器路由帧用的同一本册子 —— 它认得，才有轮次可停。 */
    if live.book.slot(&addressed).map_err(translate)?.is_none() {
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
