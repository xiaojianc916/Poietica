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
  /** Emits run events in seq order; returns an unsubscribe function. */
  readonly subscribe: (listener: (event: RunEvent) => void) => () => void
  readonly prompt: (request: AgentPromptRequest) => Promise<AgentPromptHandle>
  readonly resolvePermission: (requestId: string, optionId: string) => Promise<void>
  /** Replays a persisted run out of the encrypted event log. */
  readonly loadRun: (runId: RunId) => Promise<readonly RunEvent[]>
  /**
   * Replays a window of a conversation out of the encrypted event log.
   *
   * A window rather than the whole thing: a conversation that has seen real
   * use holds tens of thousands of frames, and reading all of them lands on
   * the click that opened it. How wide is the caller's decision, and the total
   * comes back with it so the caller can tell whether it is looking at the
   * beginning of the conversation or only at the part it asked for.
   *
   * Optional because a port that has no log behind it — a recorded replay,
   * a fixture — has no conversation to read, and a surface built against
   * one must still render.
   */
  readonly loadThread?: (
    threadId: ThreadId,
    recentRuns?: number,
  ) => Promise<{
    readonly events: readonly RunEvent[]
    /** 这条对话一共有多少轮。 */
    readonly totalRuns: number
  }>
}
