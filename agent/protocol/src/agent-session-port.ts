import type { AcpSessionId } from './acp-session-contract'
import type { RunEvent, RunId, ThreadId } from './run-contract'

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
  readonly attachmentPaths?: readonly string[]
}

export interface AgentPromptHandle {
  readonly runId: RunId
  readonly sessionId: AcpSessionId
  readonly cancel: () => Promise<void>
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
  readonly resolvePermission: (requestId: string, optionId: string) => Promise<void>
}
