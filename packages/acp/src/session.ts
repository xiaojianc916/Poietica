import type { SessionId as AcpSessionId } from '@agentclientprotocol/sdk'
import type { RunEvent, ThreadId } from './run'

// ── from acp-session-contract.ts ──
/**
 * The ACP session vocabulary, re-exported from the official SDK.
 *
 * These names used to be transcribed by hand, right here, from the protocol
 * specification. A transcription is a second description of someone else's
 * protocol: it is only ever as fresh as the day it was typed, and it goes stale
 * in silence, because nothing fails when the protocol grows a variant we have
 * never heard of — the frame simply lands in a branch that does not exist.
 *
 * By the time this file was deleted, the hand-written copy carried eight
 * SessionUpdate variants. The protocol had thirteen. It was also missing
 * ContentChunk's messageId, which is how an agent tells us that two chunks
 * belong to the same message, and ToolCallUpdate's name.
 *
 * The Acp prefix stays. It is not a compatibility shim: it is this package
 * saying "this name belongs to the protocol, not to our product model", which
 * is the distinction run-contract.ts is built on. The types behind the prefix
 * are now upstream's, so they cannot drift.
 */

export type {
  AvailableCommand as AcpAvailableCommand,
  ContentBlock as AcpContentBlock,
  EmbeddedResourceResource as AcpEmbeddedResource,
  PermissionOption as AcpPermissionOption,
  PlanEntry as AcpPlanEntry,
  PlanEntryPriority as AcpPlanEntryPriority,
  PlanEntryStatus as AcpPlanEntryStatus,
  SessionId as AcpSessionId,
  SessionNotification as AcpSessionNotification,
  SessionUpdate as AcpSessionUpdate,
  StopReason as AcpStopReason,
  ToolCallContent as AcpToolCallContent,
  ToolCallId as AcpToolCallId,
  ToolCallLocation as AcpToolCallLocation,
  ToolCallStatus as AcpToolCallStatus,
  ToolCallUpdate as AcpToolCallUpdate,
  ToolKind as AcpToolKind,
} from '@agentclientprotocol/sdk'

// ── from agent-session-port.ts ──
/**
 * The agent session port.
 *
 * The implementation is Rust behind typed IPC: it owns the ACP client, the agent
 * subprocess and every credential. This interface is the entire surface the UI
 * is allowed to know about.
 *
 * 历史不从这里来。一条对话的经过由持有它的 agent 在 session/load 期间重放，
 * 随打开这条对话的那次答复一起交回（见 thread-port.ts 的 OpenedThread.events）。
 * 这个端口只管正在发生的事。
 */

/**
 * 一张随这句话送出去的图片，按它在原生交付注册表里的位置点名。
 *
 * 字节不在这一层，也从不经过这一层。用户把文件放进输入框的那一刻它们就已经
 * 在原生侧了，这里拿着的只是取得它的两个令牌。所以这个包不认识 File，不认识
 * base64，也不认识 object URL —— 那些都是浏览器的东西，不是协议的东西。
 *
 * 协议本身要的 base64 由持有字节的那一侧编（见 commands/agent.rs 的 keep_bytes）：
 * agent 是另一个进程，那一份省不掉，但它不该在 webview 与原生之间往返一趟。
 */
export interface PromptAsset {
  /** 这张图挂在哪条资产会话下。 */
  readonly sessionToken: string
  /** 它在那条会话里的令牌，也就是内容摘要。 */
  readonly assetToken: string
}

export interface AgentPromptRequest {
  readonly threadId: ThreadId
  readonly text: string
  /**
   * 这一句带的图片。
   *
   * 与 text 是同一句话的两半：只有图、没有字，仍然是一句完整的话。没有附件
   * 时是空数组，而不是缺席 —— 一个「有时候不在」的字段会让每个读它的人都先
   * 判一次空。
   */
  readonly assets: readonly PromptAsset[]
}

/**
 * 这一轮发到了哪条会话，以及这一句里的图片在哪。
 *
 * 两格，都是原生侧才说得出的事实。此前它还带着一个轮次号和一个取消闭包 ——
 * 号是本仓库自己发明的地址，闭包则让「停止」变成一件要先存住、过一会儿再找
 * 回来的东西：上层为此维护了一张对话 → 闭包的表。取消本来只需要点名一条对话，
 * 见下面的 cancel。
 */
export interface AgentPromptHandle {
  readonly sessionId: AcpSessionId
  /**
   * 这一句里的图片在 webview 里的地址，顺序与用户挑的一致。
   *
   * 与重开这条对话时拿到的那些是同一种东西（见 thread.ts 的 ThreadAttachment）：
   * 字节由原生侧持有，地址也由它发。这一层因此不认识 data: URL，也不认识
   * object URL —— 那些是浏览器的东西，不是这条管线的东西。
   */
  readonly images: readonly string[]
}

export interface AgentSessionPort {
  /**
   * Emits run events with the session they belong to; returns an unsubscribe
   * function.
   *
   * 地址是会话号，和 ACP 的 session/update 同一个主语。它由原生侧写在信封上
   * （frame.rs 的 Envelope.session_id），六种帧无一例外，所以订阅者不必猜。
   *
   * 它先于帧存在：一条对话在打开的那一刻就握住了会话号（ThreadRecord.sessionId），
   * 而帧是此后才发生的事。此前这里是轮次号，它由 prompt 的答复带回来，比原生
   * 广播晚到 —— 上层那一整套排队、补投、计数与上限，就是为了等它才长出来的。
   *
   * seq 也随之改为按会话单调，所以按 seq 去重在两轮之间仍然成立。
   */
  readonly subscribe: (listener: (event: RunEvent, sessionId: AcpSessionId) => void) => () => void
  readonly prompt: (request: AgentPromptRequest) => Promise<AgentPromptHandle>
  /**
   * 停掉这条对话上正在跑的那一轮。
   *
   * 点名一条对话，不是一轮。ACP 的取消发给一条会话，而一条对话持有一条会话，
   * 这条对应关系在打开这条对话时就已经写下 —— 取消因此不需要在它之外再记住
   * 任何东西，也就没有什么会过期。
   */
  readonly cancel: (threadId: ThreadId) => Promise<void>
  readonly resolvePermission: (requestId: string, optionId: string) => Promise<void>
}
