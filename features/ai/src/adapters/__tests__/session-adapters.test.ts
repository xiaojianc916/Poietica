import { describe, expect, it } from 'vitest'

import type { RunEvent } from '../../contracts/run-contract'
import { SAMPLE_RUN_EVENTS } from '../../domain/timeline-fixtures'
import { replayRunEvents } from '../../domain/timeline-reducer'
import { createIpcSession } from '../ipc-session'
import { createReplaySession } from '../replay-session'

describe('replay session', () => {
  it('emits the recorded run in order under an injected scheduler', async () => {
    const queue: Array<() => void> = []
    const session = createReplaySession({
      scheduler: (callback) => {
        queue.push(callback)
        return () => {}
      },
    })

    const received: RunEvent[] = []
    session.subscribe((event) => received.push(event))
    await session.prompt({ threadId: 't', text: 'hi' })

    for (const step of queue) {
      step()
    }

    expect(received).toEqual(SAMPLE_RUN_EVENTS)
    expect(replayRunEvents('run', received).status).toBe('completed')
  })
})

describe('ipc session', () => {
  it('drops malformed frames instead of forwarding them', () => {
    let emit: (payload: unknown) => void = () => {}
    const issues: string[] = []

    const session = createIpcSession({
      bridge: {
        prompt: () => Promise.resolve({ runId: 'r', sessionId: 's' }),
        cancel: () => Promise.resolve(),
        resolvePermission: () => Promise.resolve(),
        loadRun: () => Promise.resolve([]),
      },
      source: {
        listen: (handler) => {
          emit = handler
          return () => {}
        },
      },
      onInvalidFrame: (issue) => issues.push(issue),
    })

    const received: RunEvent[] = []
    session.subscribe((event) => received.push(event))

    emit({ kind: 'nonsense' })
    emit(SAMPLE_RUN_EVENTS.at(0))

    expect(issues).toHaveLength(1)
    expect(received).toHaveLength(1)
  })
})
