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

export interface AgentPromptRequest {
  readonly threadId: ThreadId
  readonly text: string
}

/**
 * 这一轮发到了哪条会话。
 *
 * 只剩一格。此前它还带着一个轮次号和一个取消闭包 —— 号是本仓库自己发明的
 * 地址，闭包则让「停止」变成一件要先存住、过一会儿再找回来的东西：上层为此
 * 维护了一张对话 → 闭包的表。取消本来只需要点名一条对话，见下面的 cancel。
 */
export interface AgentPromptHandle {
  readonly sessionId: AcpSessionId
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
