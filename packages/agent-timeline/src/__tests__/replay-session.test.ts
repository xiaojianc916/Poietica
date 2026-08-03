import type { RunEvent } from '@poietica/acp'
import { describe, expect, it } from 'vitest'
import { SAMPLE_RUN_EVENTS } from '../__fixtures__'
import { replayRunEvents } from '../index'
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
    await session.prompt({ threadId: 't', text: 'hi', assets: [] })

    for (const step of queue) {
      step()
    }

    expect(received).toEqual(SAMPLE_RUN_EVENTS)
    expect(replayRunEvents(received).status).toBe('completed')
  })
})
