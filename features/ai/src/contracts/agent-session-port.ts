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
}
