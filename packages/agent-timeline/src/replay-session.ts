import type {
  AcpSessionId,
  AgentPromptHandle,
  AgentPromptRequest,
  AgentSessionPort,
  RunEvent,
} from '@poietica/acp'
import { SAMPLE_RUN_EVENTS } from './__fixtures__/index'

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

/* 录像里只有一条会话：假的端口也按真的契约说话，而契约上的地址是会话号。 */
const SESSION: AcpSessionId = 'sess_replay'

export function createReplaySession(options: ReplaySessionOptions = {}): AgentSessionPort {
  const events = options.events ?? SAMPLE_RUN_EVENTS
  const stepMs = options.stepMs ?? 40
  const scheduler = options.scheduler ?? defaultScheduler

  const listeners = new Set<(event: RunEvent, sessionId: AcpSessionId) => void>()
  let pending: Array<() => void> = []

  const clearPending = () => {
    for (const cancel of pending) {
      cancel()
    }
    pending = []
  }

  const emit = (event: RunEvent) => {
    for (const listener of listeners) {
      listener(event, SESSION)
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

      events.forEach((event, index) => {
        pending.push(scheduler(() => emit(event), stepMs * index))
      })

      return Promise.resolve({ sessionId: SESSION, images: [] })
    },

    /* 录像里只有一条对话，所以停的就是它 —— 点名哪一条不改变要做的事。 */
    cancel: () => {
      clearPending()

      return Promise.resolve()
    },

    resolvePermission: () => Promise.resolve(),
  }
}
