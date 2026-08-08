import type { RunEvent } from '@poietica/agent-contract'
import { describe, expect, it } from 'vitest'
import { replayRunEvents } from '../timeline-reducer'

/*
 * 边界由谁说了算。
 *
 * 第一条锁住此前的盲区：两条独立消息之间没有任何条目打断，光看「末尾封没封口」
 * 分不出来，只有 messageId 分得出。第二条锁住不报身份的 agent —— 它的画面必须
 * 与今天逐字一致。
 */

function said(seq: number, text: string, messageId?: string): RunEvent {
  return {
    kind: 'acp_update',
    seq,
    at: seq,
    notification: {
      sessionId: 's',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text },
        ...(messageId === undefined ? {} : { messageId }),
      },
    },
  }
}

function spoken(events: readonly RunEvent[]): readonly string[] {
  return replayRunEvents(events)
    .items.filter((item) => item.type === 'agent_text')
    .map((item) => (item.type === 'agent_text' ? item.text : ''))
}

describe('message identity', () => {
  it('separates two back-to-back messages that nothing interrupts', () => {
    expect(
      spoken([
        said(1, '我先查一下。', 'm1'),
        said(2, '查完了，', 'm2'),
        said(3, '结果是这样。', 'm2'),
      ]),
    ).toEqual(['我先查一下。', '查完了，结果是这样。'])
  })

  it('falls back to adjacency when the agent reports no identity', () => {
    expect(spoken([said(1, 'a'), said(2, 'b'), said(3, 'c')])).toEqual(['abc'])
  })
})
