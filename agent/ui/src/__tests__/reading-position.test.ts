import { describe, expect, it } from 'vitest'
import { type RowSpan, rowAtAnchor } from '../feed/reading-position'
import { turnIndexAtRow } from '../minimap/turn-index'

/* poietica:conversation-minimap-jump@v11 */

/** 三行,高度各异 —— 会话行本来就不等高,等高的样例证明不了什么。 */
const SPANS: readonly RowSpan[] = [
  { index: 0, start: 0, end: 80 },
  { index: 1, start: 80, end: 1200 },
  { index: 2, start: 1200, end: 1260 },
]

describe('rowAtAnchor', () => {
  it('空表没有答案,而不是第 0 行', () => {
    expect(rowAtAnchor([], 100)).toBeNull()
  })

  it('命中覆盖锚点的那一行', () => {
    expect(rowAtAnchor(SPANS, 40)).toBe(0)
    expect(rowAtAnchor(SPANS, 600)).toBe(1)
    expect(rowAtAnchor(SPANS, 1250)).toBe(2)
  })

  it('边界归属下一行,不归属上一行', () => {
    expect(rowAtAnchor(SPANS, 80)).toBe(1)
    expect(rowAtAnchor(SPANS, 1200)).toBe(2)
  })

  it('一行高过整屏时,锚点停在它身上', () => {
    expect(rowAtAnchor(SPANS, 81)).toBe(1)
    expect(rowAtAnchor(SPANS, 1199)).toBe(1)
  })

  it('越出两端时落到最近的一行', () => {
    expect(rowAtAnchor(SPANS, -500)).toBe(0)
    expect(rowAtAnchor(SPANS, 99999)).toBe(2)
  })
})

describe('turnIndexAtRow', () => {
  const TURNS = [{ rowIndex: 0 }, { rowIndex: 4 }, { rowIndex: 9 }, { rowIndex: 30 }]

  it('取最后一个起点不晚于当前行的轮次', () => {
    expect(turnIndexAtRow(TURNS, 0)).toBe(0)
    expect(turnIndexAtRow(TURNS, 3)).toBe(0)
    expect(turnIndexAtRow(TURNS, 4)).toBe(1)
    expect(turnIndexAtRow(TURNS, 29)).toBe(2)
    expect(turnIndexAtRow(TURNS, 30)).toBe(3)
    expect(turnIndexAtRow(TURNS, 9999)).toBe(3)
  })

  it('当前行在第一轮之前时停在第一轮', () => {
    expect(turnIndexAtRow([{ rowIndex: 5 }], 0)).toBe(0)
  })

  it('没有轮次时是 0', () => {
    expect(turnIndexAtRow([], 12)).toBe(0)
  })
})
