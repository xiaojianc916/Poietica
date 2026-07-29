import type { ConversationTurn } from '@poietica/agent-timeline'
import { describe, expect, it } from 'vitest'
import { RAIL_INSET_PX, RAIL_PITCH_PX, railCapacity } from '../minimap/rail-budget'
import { groupTurns } from '../minimap/rail-groups'
import { turnIndexAtRow } from '../minimap/turn-index'

/* poietica:conversation-minimap-density@v19 */

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
