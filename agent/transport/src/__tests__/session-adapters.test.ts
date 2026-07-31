import type { RunEvent } from '@poietica/agent-protocol'
import { replayRunEvents } from '@poietica/agent-timeline'
import { SAMPLE_RUN_EVENTS } from '@poietica/agent-timeline/fixtures'
import { describe, expect, it } from 'vitest'
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
  it('原样转发帧与它的地址，不在客户端重新描述协议', () => {
    let emit: (payload: unknown, runId: string) => void = () => {}

    const session = createIpcSession({
      bridge: {
        prompt: () => Promise.resolve({ runId: 'r', sessionId: 's' }),
        cancel: () => Promise.resolve(),
        resolvePermission: () => Promise.resolve(),
        loadRun: () => Promise.resolve([]),
        loadThread: () => Promise.resolve([]),
      },
      source: {
        listen: (handler) => {
          emit = handler
          return () => {}
        },
      },
    })

    const received: Array<[RunEvent, string]> = []
    session.subscribe((event, runId) => received.push([event, runId]))

    const first = SAMPLE_RUN_EVENTS.at(0)

    emit(first, 'r')

    /*
     * 帧的形状由原生侧的 RunFrame enum 保证，地址由信封给出。这一层不再持有
     * 第二份协议描述，因此也不会把一个它这版还不认识的字段判成「无法解析」，
     * 更不会在时间线上插一条客户端自造的 run_failed。
     */
    expect(received).toHaveLength(1)
    expect(received.at(0)?.[0]).toEqual(first)
    expect(received.at(0)?.[1]).toBe('r')
  })
})
