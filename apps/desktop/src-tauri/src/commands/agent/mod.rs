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

use crate::error::IpcError;
use std::time::Duration;

mod addressing;
mod attachment;
mod config;
mod dto;
mod failure;
mod runtime;
mod store;
mod thread;
mod turn;

/// 这个模块交出去的东西：十一条命令、它们签名里的 DTO，以及托管状态。
///
/// 一条一条写出来，不用通配。此前那九行里有四行 —— addressing、attachment、
/// failure、store —— 一个 pub 项都没有，编译器对每一行都报了 glob import
/// doesn't reexport anything：通配让「这里到底导出了什么」读不出来，那四行
/// 才会一直躺着没人发现。这张清单与 crate::ipc::surface 的 collect_commands!
/// 是同一张，漏掉一条，编译当场就会指出来。
pub use config::{agent_capabilities, agent_set_config_option};
pub use dto::{
    AgentCancelRequest, AgentCapabilitiesRequest, AgentConfigChoice, AgentConfigControl,
    AgentConfigPurpose, AgentHistory, AgentHistoryLoss, AgentLaunch, AgentOpenThreadRequest,
    AgentOpenedThread, AgentPinThreadRequest, AgentPromptAsset, AgentPromptRequest,
    AgentPromptResult, AgentRenameThreadRequest, AgentResolvePermissionRequest,
    AgentSelectConfigRequest, AgentSelectorReport, AgentThread, AgentThreadAttachment,
    AgentThreadRequest, AgentTitleSource,
};
pub use runtime::AgentRuntime;
pub use thread::{
    agent_delete_thread, agent_open_thread, agent_pin_thread, agent_rename_thread, agent_threads,
};
pub use turn::{agent_cancel, agent_prompt, agent_resolve_permission, agent_shutdown};

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
