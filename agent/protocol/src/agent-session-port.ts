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
   * Emits run events with the run they belong to; returns an unsubscribe function.
   *
   * The run identifier is a parameter rather than a field on the frame because
   * the frames themselves carry no address: every variant in run-contract.ts is
   * { kind, seq, at, ... }. A subscriber that is handed a frame without one can
   * only guess which conversation it belongs to, and seq is numbered per run, so
   * two turns both have a seq 3 and de-duplicating by seq cannot tell them apart.
   *
   * Multiplexed transports address every message: JSON-RPC has id, LSP has the
   * request id, gRPC has the stream id, ACP's session/update carries sessionId.
   * This is that, and nothing more.
   */
  readonly subscribe: (listener: (event: RunEvent, runId: RunId) => void) => () => void
  readonly prompt: (request: AgentPromptRequest) => Promise<AgentPromptHandle>
  readonly resolvePermission: (requestId: string, optionId: string) => Promise<void>
}
