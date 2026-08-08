import type { RunEvent } from '@poietica/agent-contract'
import { describe, expect, it } from 'vitest'
import { applyRunEvents, createTimelineState } from '../timeline-reducer'

/*
 * 分批是 applyRunEvents 存在的全部理由：上游按屏幕的节拍攒帧，一拍一趟草稿。于是
 * 「一条工具卡片在第二拍里还认不认得自己」这件事，全压在「下标一旦记下就不再移动」
 * 这一条不变式上 —— 而它此前没有任何测试。
 *
 * 索引跨趟继承之后，这条不变式从一个实现细节变成了契约：它不成立，第二拍的更新就会
 * 落到别的条目上，或者凭空多出一张卡。所以这几条不是附赠的覆盖率，是那次改动的前提。
 */

const opened = (seq: number): RunEvent => ({
  kind: 'acp_update',
  seq,
  at: seq,
  notification: {
    sessionId: 's',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'call_1',
      title: '读文件',
      status: 'in_progress',
    },
  },
})

const output = (seq: number, text: string): RunEvent => ({
  kind: 'acp_update',
  seq,
  at: seq,
  notification: {
    sessionId: 's',
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call_1',
      content: [{ type: 'content', content: { type: 'text', text } }],
    },
  },
})

const plan = (seq: number, content: string): RunEvent => ({
  kind: 'acp_update',
  seq,
  at: seq,
  notification: {
    sessionId: 's',
    update: {
      sessionUpdate: 'plan',
      entries: [{ content, status: 'pending', priority: 'low' }],
    },
  },
})

describe('分批喂帧', () => {
  it('分几批喂和一批喂完，转录逐字相同', () => {
    const events = [opened(1), output(2, 'a'), output(3, 'ab'), output(4, 'abc')]
    const once = applyRunEvents(createTimelineState(), events)

    let split = createTimelineState()

    for (const event of events) {
      split = applyRunEvents(split, [event])
    }

    expect(split.items).toEqual(once.items)
    expect(split.lastSeq).toBe(once.lastSeq)
    expect(split.status).toBe(once.status)
  })

  it('后一批的更新落回同一张卡，不另开一条', () => {
    const first = applyRunEvents(createTimelineState(), [opened(1), output(2, 'a')])
    const second = applyRunEvents(first, [output(3, 'ab')])
    const card = second.items.at(0)

    expect(second.items).toHaveLength(1)
    expect(card?.type === 'tool_call' && card.content).toEqual([
      { type: 'content', content: { type: 'text', text: 'ab' } },
    ])
  })

  /* 上一批推进去的那一条，下一批必须认得出来 —— 认不出就会有两份计划。 */
  it('跨批仍然只有一份计划', () => {
    const first = applyRunEvents(createTimelineState(), [opened(1)])
    const second = applyRunEvents(first, [plan(2, '一')])
    const third = applyRunEvents(second, [plan(3, '二')])
    const plans = third.items.filter((item) => item.type === 'plan')

    expect(plans).toHaveLength(1)
    expect(plans.at(0)).toMatchObject({ entries: [{ content: '二' }] })
  })

  /* 一份状态被开两次草稿：第二趟从零重建索引，答案必须与第一趟一致。 */
  it('同一份状态被接着写两次，两次都定位得对', () => {
    const held = applyRunEvents(createTimelineState(), [opened(1), plan(2, '一')])
    const left = applyRunEvents(held, [plan(3, '左')])
    const right = applyRunEvents(held, [plan(3, '右')])

    expect(left.items.filter((item) => item.type === 'plan')).toHaveLength(1)
    expect(right.items.filter((item) => item.type === 'plan')).toHaveLength(1)
  })
})
