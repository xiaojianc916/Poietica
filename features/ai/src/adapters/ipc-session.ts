import type {
  AgentPromptHandle,
  AgentPromptRequest,
  AgentSessionPort,
} from '../contracts/agent-session-port'
import type { RunEvent, RunId } from '../contracts/run-contract'
import { parseRunEvent } from '../domain/acp-event-schema'

/**
 * A session port backed by the Rust runtime.
 *
 * The bridge is injected rather than imported: the feature layer declares the
 * port it needs and the platform layer supplies it, so nothing here depends on
 * a desktop runtime and the whole adapter is unit-testable.
 *
 * Every inbound frame is validated. An agent is untrusted input even when it
 * speaks a standard protocol, so a malformed frame is reported and dropped
 * rather than allowed to corrupt the timeline.
 */

export interface AgentEventSource {
  readonly listen: (handler: (payload: unknown) => void) => () => void
}

export interface AgentCommandBridge {
  readonly prompt: (
    request: AgentPromptRequest,
  ) => Promise<{ readonly runId: RunId; readonly sessionId: string }>
  readonly cancel: (runId: RunId) => Promise<void>
  readonly resolvePermission: (requestId: string, optionId: string) => Promise<void>
  readonly loadRun: (runId: RunId) => Promise<readonly unknown[]>
}

export interface IpcSessionOptions {
  readonly bridge: AgentCommandBridge
  readonly source: AgentEventSource
  readonly onInvalidFrame?: (issue: string, payload: unknown) => void
}

export function createIpcSession({
  bridge,
  source,
  onInvalidFrame,
}: IpcSessionOptions): AgentSessionPort {
  return {
    subscribe: (listener) =>
      source.listen((payload) => {
        const parsed = parseRunEvent(payload)
        if (!parsed.ok) {
          onInvalidFrame?.(parsed.issue, payload)
          return
        }
        listener(parsed.event)
      }),

    prompt: async (request): Promise<AgentPromptHandle> => {
      const { runId, sessionId } = await bridge.prompt(request)
      return { runId, sessionId, cancel: () => bridge.cancel(runId) }
    },

    resolvePermission: (requestId, optionId) => bridge.resolvePermission(requestId, optionId),

    loadRun: async (runId) => {
      const raw = await bridge.loadRun(runId)
      const events: RunEvent[] = []
      for (const payload of raw) {
        const parsed = parseRunEvent(payload)
        if (parsed.ok) events.push(parsed.event)
        else onInvalidFrame?.(parsed.issue, payload)
      }
      return events
    },
  }
}
