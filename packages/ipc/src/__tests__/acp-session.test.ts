import type { RunEvent } from '@poietica/acp'
import { describe, expect, it } from 'vitest'
import { createIpcSession } from '../acp-session'

/* 原生侧交回来的那一种地址，原样照抄，不在这里重新拼一遍它的形状。 */
const DELIVERED = 'poietica-asset://asset/t/0000'

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
        prompt: () => Promise.resolve({ sessionId: 's', images: [] }),
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

  it('prompt 把原生侧给的会话号与图片地址原样交回，一格都不吞', async () => {
    const session = createIpcSession({
      bridge: {
        prompt: () => Promise.resolve({ sessionId: 'sess_2', images: [DELIVERED] }),
        cancel: () => Promise.resolve(),
        resolvePermission: () => Promise.resolve(),
      },
      source: { listen: () => () => {} },
    })

    /* 地址与图片一起交回。此前这一格在这一层就丢了，而屏幕上看不出来：实时
    那条路自己拼了一条 data: URL，于是协议这条路坏了很久都没有人发现。 */
    await expect(session.prompt({ threadId: 't', text: 'hi', images: [] })).resolves.toEqual({
      sessionId: 'sess_2',
      images: [DELIVERED],
    })
  })
})
