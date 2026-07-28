import type { RunEvent } from '@poietica/agent-protocol'
import { replayRunEvents, SAMPLE_RUN_EVENTS } from '@poietica/agent-timeline'
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
  it('把畸形帧变成一条可见的拒绝，而不是原样转发', () => {
    let emit: (payload: unknown) => void = () => {}
    const issues: string[] = []

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
      onInvalidFrame: (issue) => issues.push(issue),
    })

    const received: RunEvent[] = []
    session.subscribe((event) => received.push(event))

    emit({ kind: 'nonsense' })
    emit(SAMPLE_RUN_EVENTS.at(0))

    /*
     * 适配器先把畸形帧报告出去，再在它的位置上发出一条 run_failed 拒绝，
     * 这样时间线呈现的是「这一轮被中断了」，而不是「助手根本没说话」。
     * seq 为 0 是刻意的：真实帧从 1 开始编号，永不碰撞，reducer 只保留每轮
     * 第一条拒绝。详见 ipc-session.ts 里 refusedFrame 上方的论证。
     *
     * 旧断言要求畸形帧不留痕迹地消失，那正是这个适配器明确放弃的策略。
     */
    expect(issues).toHaveLength(1)
    expect(received).toHaveLength(2)
    expect(received.at(0)).toMatchObject({ kind: 'run_failed', seq: 0 })
    expect(received.at(1)).toEqual(SAMPLE_RUN_EVENTS.at(0))
  })
})
