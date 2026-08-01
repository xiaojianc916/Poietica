import type { ConversationTurn } from '@poietica/agent-timeline'
import { describe, expect, it } from 'vitest'
import { RAIL_INSET_PX, RAIL_PITCH_PX, railCapacity } from '../minimap/rail-budget'
import { groupTurns } from '../minimap/rail-groups'
import { turnIndexAtRow } from '../minimap/turn-index'

/* poietica:conversation-minimap-density@v23 */

/*
 * 造一个轮次。
 *
 * 断言只碰 groupTurns 会读的四个字段,所以这里断言的是"够用",不是"完整" ——
 * 时间线以后给 ConversationTurn 加字段,不该逼这个文件跟着改。行号故意留出
 * 空隙:轮次之间有别的行,rowIndex 不等于序号,这一点是真实的。
 */
function turn(ordinal: number): ConversationTurn {
  return {
    id: `t${String(ordinal)}`,
    rowIndex: ordinal * 3,
    label: `turn ${String(ordinal)}`,
  } as ConversationTurn
}

function conversation(length: number): readonly ConversationTurn[] {
  return Array.from({ length }, (_ignored, index) => turn(index + 1))
}

/** 一格覆盖的轮次区间,turn 与 cluster 统一成同一种形状。 */
function span(item: ReturnType<typeof groupTurns>[number]): readonly [number, number] {
  return item.kind === 'cluster' ? [item.from, item.to] : [item.ordinal, item.ordinal]
}

describe('railCapacity', () => {
  it('未测量时不介入', () => {
    expect(railCapacity(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
    expect(railCapacity(0)).toBe(Number.POSITIVE_INFINITY)
    expect(railCapacity(Number.NaN)).toBe(Number.POSITIVE_INFINITY)
  })

  it('扣掉护栏裁掉的那两条边', () => {
    const tenRows = RAIL_PITCH_PX * 10 + RAIL_INSET_PX * 2

    expect(railCapacity(tenRows)).toBe(10)
    /* 少一个像素就装不下第十格 —— 护栏会裁,容量就得先认。 */
    expect(railCapacity(tenRows - 1)).toBe(9)
  })

  it('再矮也至少留一格', () => {
    expect(railCapacity(1)).toBe(1)
  })
})

describe('groupTurns', () => {
  it('空会话不产出格子', () => {
    expect(groupTurns([], 10)).toEqual([])
  })

  it('装得下就一轮一格,不并', () => {
    const items = groupTurns(conversation(20), 20)

    expect(items).toHaveLength(20)
    expect(items.every((item) => item.kind === 'turn')).toBe(true)
  })

  it('未测量时不并格', () => {
    const items = groupTurns(conversation(1000), Number.POSITIVE_INFINITY)

    expect(items).toHaveLength(1000)
  })

  it('差一格就开始并', () => {
    const items = groupTurns(conversation(20), 19)

    expect(items.length).toBeLessThanOrEqual(19)
    expect(items.some((item) => item.kind === 'cluster')).toBe(true)
  })

  /*
   * 这一条就是整次改动要证明的东西:轨道的格数不随会话长度增长。
   *
   * 六个规模一起跑,是因为"在 N=8 的截图里评审通过"正是这个控件出问题的方式。
   */
  it.each([1, 5, 20, 60, 200, 1000])('N=%i 时格数不超过预算', (length) => {
    const capacity = railCapacity(720)
    const items = groupTurns(conversation(length), capacity)

    expect(items.length).toBeLessThanOrEqual(Math.max(capacity, 0))
    expect(items.length).toBeLessThanOrEqual(length)
    expect(items.length).toBeGreaterThan(0)
  })

  it.each([1, 5, 20, 60, 200, 1000])('N=%i 时 rowIndex 严格递增', (length) => {
    const items = groupTurns(conversation(length), railCapacity(720))

    for (let index = 1; index < items.length; index += 1) {
      const previous = items[index - 1]
      const current = items[index]

      expect(previous).toBeDefined()
      expect(current).toBeDefined()
      expect(current?.rowIndex).toBeGreaterThan(previous?.rowIndex ?? Number.NaN)
    }
  })

  /*
   * 不丢轮次,也不重复计数。
   *
   * 一格代表一段,那么各段首尾相接、并集恰好是 1…N —— 否则播报的"第 12–19 轮"
   * 就是在谎报位置,而这比少画几根横条严重得多。
   */
  it.each([1, 5, 20, 60, 200, 1000])('N=%i 时区间无缝且完整', (length) => {
    const items = groupTurns(conversation(length), railCapacity(720))
    const spans = items.map(span)

    expect(spans[0]?.[0]).toBe(1)
    expect(spans[spans.length - 1]?.[1]).toBe(length)

    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index]?.[0]).toBe((spans[index - 1]?.[1] ?? Number.NaN) + 1)
    }

    for (const [from, to] of spans) {
      expect(to).toBeGreaterThanOrEqual(from)
    }
  })

  it('并格之后二分仍然指得对', () => {
    const turns = conversation(200)
    const items = groupTurns(turns, railCapacity(720))

    for (const [index, item] of items.entries()) {
      /* 段首那一行,落在这一格。 */
      expect(turnIndexAtRow(items, item.rowIndex)).toBe(index)

      /* 段内任意一行,仍落在这一格 —— 下一格的入口之前都算这一段。 */
      const next = items[index + 1]
      const inside = next === undefined ? item.rowIndex + 2 : next.rowIndex - 1

      expect(turnIndexAtRow(items, inside)).toBe(index)
    }
  })

  it('桶首代表整桶,跳转落在段首', () => {
    const turns = conversation(100)
    const items = groupTurns(turns, 10)
    const heads = new Set(turns.map((each) => each.rowIndex))

    for (const item of items) {
      expect(heads.has(item.rowIndex)).toBe(true)
    }
  })

  it('预算只剩一格时全部并成一格', () => {
    const items = groupTurns(conversation(200), 1)

    expect(items).toHaveLength(1)
    expect(span(items[0]!)).toEqual([1, 200])
  })
})

/* 本地夹具:不借上面的 helper,免得那边改了名字这一段跟着碎。 */
function focused(length: number) {
  return Array.from({ length }, (_, index) => ({
    id: `f${String(index)}`,
    rowIndex: index * 3,
    label: `turn ${String(index + 1)}`,
  }))
}

describe('groupTurns 的焦点', () => {
  it('keeps the focused turn expanded past the height budget', () => {
    const turns = focused(60)
    const items = groupTurns(turns, 12, 43)
    const hit = items.find((item) => item.rowIndex === turns[43]?.rowIndex)

    expect(hit?.kind).toBe('turn')
  })

  it('never spends more slots than the budget', () => {
    for (const active of [0, 1, 29, 58, 59]) {
      expect(groupTurns(focused(60), 12, active).length).toBeLessThanOrEqual(12)
    }
  })

  it('keeps rowIndex strictly increasing so the binary search holds', () => {
    const items = groupTurns(focused(200), 20, 137)

    for (let index = 1; index < items.length; index += 1) {
      expect(items[index]?.rowIndex).toBeGreaterThan(items[index - 1]?.rowIndex ?? -1)
    }
  })

  it('never drops the far side of the conversation', () => {
    expect(groupTurns(focused(60), 12, 59)[0]?.rowIndex).toBe(0)
    const tail = groupTurns(focused(60), 12, 0).at(-1)

    expect(tail === undefined ? -1 : span(tail)[1]).toBe(60)
  })

  it('falls back to even buckets with no focus', () => {
    expect(groupTurns(focused(60), 12, -1)).toEqual(groupTurns(focused(60), 12))
  })
})

describe('groupTurns 的网格', () => {
  /*
   * 不去比"焦点挪一轮之后格子是不是原地不动"。那条测试看着更直白,却是脆的:
   * 挪一轮可能刚好跨过预算边界、整体升一档,于是全盘重排,红得毫无信息量。
   * 这里断言的是它不动的**原因** —— 宽度为 2^k 的桶,起点必是 2^k 的倍数。
   * 满足这一条,桶就只能在固定网格线上合并分裂,不可能平移。
   */
  it('桶边界锚定在绝对网格上', () => {
    const length = 300
    const items = groupTurns(focused(length), 30, 100)

    for (const item of items) {
      if (item.kind !== 'cluster' || item.to === length) {
        continue
      }

      const from = item.from - 1
      const width = item.to - from

      expect(Number.isInteger(Math.log2(width))).toBe(true)
      expect(from % width).toBe(0)
    }
  })

  it('离焦点越远,一格代表的轮次越多', () => {
    const items = groupTurns(focused(400), 40, 200)
    const widths = items.map((item) => (item.kind === 'cluster' ? item.to - item.from + 1 : 1))

    expect(widths[0] ?? 0).toBeGreaterThan(widths[Math.floor(widths.length / 2)] ?? 0)
  })

  /* 预算、无缝、完整 —— 三条一起,在焦点落在头、中、尾三处时都要成立。 */
  it.each([
    [60, 12],
    [100, 55],
    [300, 30],
    [1000, 55],
  ])('N=%i cap=%i 时带焦点也不超预算且区间无缝', (length, cap) => {
    for (const active of [0, Math.floor(length / 2), length - 1]) {
      const spans = groupTurns(focused(length), cap, active).map(span)

      expect(spans.length).toBeLessThanOrEqual(cap)
      expect(spans[0]?.[0]).toBe(1)
      expect(spans.at(-1)?.[1]).toBe(length)

      for (let index = 1; index < spans.length; index += 1) {
        expect(spans[index]?.[0]).toBe((spans[index - 1]?.[1] ?? Number.NaN) + 1)
      }
    }
  })
})
