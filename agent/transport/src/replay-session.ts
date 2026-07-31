import type {
  AgentPromptHandle,
  AgentPromptRequest,
  AgentSessionPort,
  RunEvent,
  RunId,
} from '@poietica/agent-protocol'
import { SAMPLE_RUN_EVENTS } from '@poietica/agent-timeline/fixtures'

/**
 * A session port that replays a recorded run.
 *
 * The activity feed must be buildable, reviewable and testable before any agent
 * process exists, so this adapter emits real run events on a real schedule with
 * no protocol, no subprocess and no credentials involved. Tests inject their own
 * scheduler and drive the run frame by frame.
 */

export type ReplayScheduler = (callback: () => void, delayMs: number) => () => void

export interface ReplaySessionOptions {
  readonly events?: readonly RunEvent[]
  readonly stepMs?: number
  readonly scheduler?: ReplayScheduler
}

const defaultScheduler: ReplayScheduler = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs)
  return () => clearTimeout(handle)
}

export function createReplaySession(options: ReplaySessionOptions = {}): AgentSessionPort {
  const events = options.events ?? SAMPLE_RUN_EVENTS
  const stepMs = options.stepMs ?? 40
  const scheduler = options.scheduler ?? defaultScheduler

  const listeners = new Set<(event: RunEvent, runId: RunId) => void>()
  let pending: Array<() => void> = []
  let runCounter = 0
  /* 录像也得报出这一帧属于哪一轮：假的端口按真的契约说话，否则它测不出什么。 */
  let current: RunId = 'run_replay_0'

  const clearPending = () => {
    for (const cancel of pending) {
      cancel()
    }
    pending = []
  }

  const emit = (event: RunEvent) => {
    for (const listener of listeners) {
      listener(event, current)
    }
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    prompt: (_request: AgentPromptRequest): Promise<AgentPromptHandle> => {
      clearPending()
      runCounter += 1
      const runId = `run_replay_${String(runCounter)}`

      current = runId

      events.forEach((event, index) => {
        pending.push(scheduler(() => emit(event), stepMs * index))
      })

      return Promise.resolve({
        runId,
        sessionId: 'sess_replay',
        cancel: () => {
          clearPending()
          return Promise.resolve()
        },
      })
    },

    resolvePermission: () => Promise.resolve(),
  }
}
