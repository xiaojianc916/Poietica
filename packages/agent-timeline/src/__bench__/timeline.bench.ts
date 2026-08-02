import type { TimelineState } from '@poietica/agent-timeline'
import {
  applyRunEvents,
  replayThreadEvents,
  selectFeedRows,
  selectTurns,
} from '@poietica/agent-timeline'
import { bench, describe } from 'vitest'
import { conversationOf, tickOf } from './workload'

/*
 * 派生管线的三个问题，各自一组测量。
 *
 * 每一组都跑三档规模。单档只能回答「多快」，三档才能回答「随什么增长」——
 * 而后者才是这里真正要问的：一次 paint tick 的代价该是常数，如果它随对话
 * 长度线性上涨，那么一次回答的总代价就是 O(N²)，长对话必然卡。
 */

const SIZES = [200, 2_000, 10_000] as const

/** 一条已经躺在那里的对话，作为流式追加的基线。 */
function settled(items: number): TimelineState {
  return replayThreadEvents(conversationOf(Math.ceil(items / 3), 8).events)
}

describe('ingest: 一拍 16 段文本，折进一条已有的对话', () => {
  for (const size of SIZES) {
    const base = settled(size)
    const batch = tickOf(base.lastSeq + 1, 16)

    /* 期望：三档持平。若随 size 线性上涨，元凶是 draftOf 的 items.slice()。 */
    bench(`items=${String(size)}`, () => {
      applyRunEvents(base, batch)
    })
  }
})

describe('grow: 同一条消息连续追加', () => {
  for (const size of [500, 2_000, 8_000] as const) {
    const batch = tickOf(1, size)

    /*
     * 期望：与 size 成正比。若明显超线性（8000 档远超 2000 档的四倍），
     * 元凶是 appendChunk 的 { ...tail, text: tail.text + chunk } ——
     * 每段都复制一遍整条已生成文本。
     */
    bench(`chunks=${String(size)}`, () => {
      applyRunEvents({ status: 'idle', items: [], lastSeq: 0, runIndex: 0 }, batch)
    })
  }
})

describe('open: 冷启一条既存对话（打开会话那一刻的延迟）', () => {
  for (const size of SIZES) {
    const { events } = conversationOf(Math.ceil(size / 3), 8)

    bench(`items=${String(size)}`, () => {
      replayThreadEvents(events)
    })
  }
})

describe('project: 一拍之后重投影行与轮次', () => {
  for (const size of SIZES) {
    const base = settled(size)
    const batch = tickOf(base.lastSeq + 1, 16)

    /* 期望：三档持平。选择器自称是增量的，这一组就是那句话的证据。 */
    bench(`items=${String(size)}`, () => {
      const next = applyRunEvents(base, batch)

      selectTurns(selectFeedRows(next))
    })
  }
})
