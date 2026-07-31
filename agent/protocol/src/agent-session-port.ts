import type { AcpSessionId } from './acp-session-contract'
import type { RunEvent, RunId, ThreadId } from './run-contract'

/**
 * The agent session port.
 *
 * The implementation is Rust behind typed IPC: it owns the ACP client, the agent
 * subprocess and every credential. This interface is the entire surface the UI
 * is allowed to know about.
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
  /** Replays a persisted run out of the encrypted event log. */
  readonly loadRun: (runId: RunId) => Promise<readonly RunEvent[]>
  /**
   * Replays a conversation, whole.
   *
   * 整条而不是一段。一条会话的重播由 agent 一次给全（ACP 的 session/load 期间，
   * 历史就是普通的 session/update 通知），所以调用方没有"要多宽"可问，也没有
   * "上面还有没有"可判 —— 那两个问题只在本地持有一份可切片的日志时才存在。
   *
   * Optional because a port that has no conversation behind it — a recorded
   * replay, a fixture — has nothing to replay, and a surface built against
   * one must still render.
   */
  readonly loadThread?: (threadId: ThreadId) => Promise<readonly RunEvent[]>
}
