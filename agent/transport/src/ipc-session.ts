import type {
  AgentPromptHandle,
  AgentPromptRequest,
  AgentSessionPort,
  RunEvent,
  RunId,
} from '@poietica/agent-protocol'
import { parseRunEvent } from '@poietica/agent-protocol'

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
  readonly loadThread: (
    threadId: string,
    recentRuns?: number,
  ) => Promise<{ readonly events: readonly unknown[]; readonly totalRuns: number }>
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
          listener(refusedFrame(parsed.issue))
          return
        }
        listener(parsed.event)
      }),

    prompt: async (request): Promise<AgentPromptHandle> => {
      const { runId, sessionId } = await bridge.prompt(request)
      return { runId, sessionId, cancel: () => bridge.cancel(runId) }
    },

    resolvePermission: (requestId, optionId) => bridge.resolvePermission(requestId, optionId),

    loadRun: async (runId) => accept(await bridge.loadRun(runId), onInvalidFrame),

    loadThread: async (threadId, recentRuns) => {
      const window = await bridge.loadThread(threadId, recentRuns)

      /* 校验只管帧；总数是原生那侧数出来的事实，原样过。 */
      return { events: accept(window.events, onInvalidFrame), totalRuns: window.totalRuns }
    },
  }
}

/*
 * Validates a batch of recorded frames.
 *
 * A single turn and a whole conversation are read back the same way, and a
 * frame this build refuses is reported and left out rather than allowed into
 * the transcript.
 */
function accept(
  raw: readonly unknown[],
  onInvalidFrame?: (issue: string, payload: unknown) => void,
): readonly RunEvent[] {
  const events: RunEvent[] = []

  for (const payload of raw) {
    const parsed = parseRunEvent(payload)

    if (parsed.ok) {
      events.push(parsed.event)
    } else {
      onInvalidFrame?.(parsed.issue, payload)
    }
  }

  return events
}

const REFUSED = '助手发回了这个界面无法解析的数据，这一轮已经中断。'

/*
 * A refused frame is a failure of this client, and it belongs on screen.
 *
 * Reporting it to a log satisfies the developer and leaves the person waiting
 * for an answer looking at a transcript in which the agent simply never spoke.
 * So the refusal enters the timeline through the same channel every other
 * failure uses.
 *
 * Sequence zero is deliberate. Real frames are numbered from one, so this can
 * never collide with one, and the reducer keeps the first refusal of a turn and
 * discards the rest: one visible failure, not a wall of them.
 */
function refusedFrame(issue: string): RunEvent {
  return {
    kind: 'run_failed',
    seq: 0,
    at: Date.now(),
    message: `${REFUSED}（${issue}）`,
  }
}
