import type { RunEvent } from '@poietica/agent-contract'
import { describe, expect, it } from 'vitest'
import { selectTurns } from '../conversation-turns'
import { selectFeedRows } from '../feed-rows'
import type { TimelineState } from '../timeline-contract'
import {
  appendUserMessage,
  applyRunEvent,
  createTimelineState,
  replayThreadEvents,
} from '../timeline-reducer'

/*
 * 一问一格。
 *
 * 缩略导航按「人问过几次」数格子（conversation-turns 的 stageTurns），所以转录里
 * 多一条用户消息，轨道上就多一根杠。这里守的是「同一句话只落一次账」这条不变式，
 * 一句话的三条到达路径各来一遍。
 */

function started(seq: number, prompt: string): RunEvent {
  return { kind: 'run_started', seq, at: seq, sessionId: 'sess', prompt }
}

function echoed(seq: number, text: string): RunEvent {
  return {
    kind: 'acp_update',
    seq,
    at: seq,
    notification: {
      sessionId: 'sess',
      update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } },
    },
  }
}

function spoke(seq: number, text: string): RunEvent {
  return {
    kind: 'acp_update',
    seq,
    at: seq,
    notification: {
      sessionId: 'sess',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
    },
  }
}

function finished(seq: number): RunEvent {
  return { kind: 'run_finished', seq, at: seq, stopReason: 'end_turn' }
}

function said(state: TimelineState): readonly string[] {
  return state.items.flatMap((item) => (item.type === 'user_message' ? [item.text] : []))
}

function rails(state: TimelineState): number {
  return selectTurns(selectFeedRows(state)).length
}

describe('one question, one rail stop', () => {
  it('takes the recorded prompt and the agent echo as the same question', () => {
    const state = replayThreadEvents([
      started(1, '读取 README'),
      echoed(2, '读取 README'),
      spoke(3, '好的，我看一下。'),
      finished(4),
    ])

    expect(said(state)).toEqual(['读取 README'])
    expect(rails(state)).toBe(1)
  })

  it('takes a question asked mid-answer and its own run prompt as one question', () => {
    const asked = appendUserMessage(createTimelineState(), '第一个问题', 1)
    const running = applyRunEvent(asked, started(1, '第一个问题'))
    const answering = applyRunEvent(running, spoke(2, '好，'))

    /* 不等它答完就问下一句：这一轮不换段，那句话落在还在跑的这一段里。 */
    const inserted = appendUserMessage(answering, '第二个问题', 3)

    /* 上一轮的收尾把它挤离末尾 —— 比「末尾那一条」的判据就是在这里落空的。 */
    const trailing = applyRunEvent(inserted, spoke(3, '这是第一问的结尾。'))
    const closed = applyRunEvent(trailing, finished(4))
    const second = applyRunEvent(closed, started(1, '第二个问题'))

    expect(said(second)).toEqual(['第一个问题', '第二个问题'])
    expect(rails(second)).toBe(2)
  })

  it('still opens a message for a question that is nothing but a picture', () => {
    const state = replayThreadEvents([
      started(1, '第一个问题'),
      spoke(2, '好。'),
      finished(3),
      started(1, ''),
      echoed(2, ''),
      spoke(3, '看到了。'),
      finished(4),
    ])

    expect(said(state)).toEqual(['第一个问题', ''])
  })

  it('keeps the injected aside out of what the user is quoted as saying', () => {
    const state = replayThreadEvents([
      started(1, '看这张图<system-reminder>图片已被压缩</system-reminder>'),
      spoke(2, '看到了。'),
      finished(3),
    ])

    expect(said(state)).toEqual(['看这张图'])
  })
})
