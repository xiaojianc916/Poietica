import type { RunEvent } from '@poietica/acp'
import { describe, expect, it } from 'vitest'
import { createIpcSession } from '../acp-session'

/*
 * 这一层只做转发。
 *
 * 帧的形状由原生侧的 RunFrame enum 保证，地址由信封给出（见 acp-session.ts
 * 开头的说明）。适配器不认识帧里的任何一格，所以这里用一个哨兵对象：要断言的
 * 是「原样交出去」，不是某一版协议长什么样。用 timeline 的真录像反而会给一个
 * 不需要它的包挂上一条依赖。
 */
describe('ipc session', () => {
  it('原样转发帧与它的地址，不在客户端重新描述协议', () => {
    let emit: (payload: unknown, sessionId: string) => void = () => {}
    const frame = { kind: 'sentinel' } as unknown as RunEvent

    const session = createIpcSession({
      bridge: {
        prompt: () => Promise.resolve({ sessionId: 's' }),
        cancel: () => Promise.resolve(),
        resolvePermission: () => Promise.resolve(),
      },
      source: {
        listen: (handler) => {
          emit = handler
          return () => {}
        },
      },
    })

    const received: Array<[RunEvent, string]> = []
    session.subscribe((event, sessionId) => received.push([event, sessionId]))

    emit(frame, 'sess_1')

    expect(received).toHaveLength(1)
    expect(received.at(0)?.[0]).toBe(frame)
    expect(received.at(0)?.[1]).toBe('sess_1')
  })

  it('prompt 交回原生侧给出的会话号，不自己发明一个', async () => {
    const session = createIpcSession({
      bridge: {
        prompt: () => Promise.resolve({ sessionId: 'sess_2' }),
        cancel: () => Promise.resolve(),
        resolvePermission: () => Promise.resolve(),
      },
      source: { listen: () => () => {} },
    })

    await expect(session.prompt({ threadId: 't', text: 'hi' })).resolves.toEqual({
      sessionId: 'sess_2',
    })
  })
})
