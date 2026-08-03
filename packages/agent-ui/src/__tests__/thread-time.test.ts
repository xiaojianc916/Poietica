import { describe, expect, it } from 'vitest'

import { datedOf, formatElapsed, nextChangeIn, sectionsOf } from '../threads/sections'

const at = (iso: string) => Date.parse(iso)

interface Row {
  readonly updatedAt: string
  readonly isPinned?: boolean
}

/*
 * 走真实管线：数据一趟（datedOf），时钟一趟（sectionsOf）。
 *
 * 期限同样只有整屏这一个入口。单行那道阶梯不再单独导出，也不该单独断言：
 * 「这一行下一次什么时候变」在屏幕上没有意义，午夜那道边界只在整屏这一层成立，
 * 而此前那条用单行入口写的断言钉住的正是一个在整屏上恒不生效的返回值。
 */
const sectionsAt = (rows: readonly Row[], now: number) => sectionsOf(datedOf(rows), now)

const horizonOf = (instants: readonly number[], now: number) =>
  nextChangeIn(
    sectionsAt(
      instants.map((instant) => ({ updatedAt: new Date(instant).toISOString() })),
      now,
    ),
    now,
  )

describe('会话时间', () => {
  it('凌晨看昨晚的对话，属于昨天而不是今天', () => {
    const now = at('2026-07-29T00:30:00')
    const sections = sectionsAt([{ updatedAt: '2026-07-28T23:00:00' }], now)

    expect(sections.map((section) => section.id)).toEqual(['yesterday'])
  })

  it('段次序固定，与数据到达先后无关', () => {
    const now = at('2026-07-29T12:00:00')
    const sections = sectionsAt(
      [
        { updatedAt: '2026-06-01T12:00:00' },
        { updatedAt: '2026-07-29T11:00:00' },
        { isPinned: true, updatedAt: '2026-07-20T12:00:00' },
      ],
      now,
    )

    expect(sections.map((section) => section.id)).toEqual(['pinned', 'today', 'earlier'])
  })

  it('段内按最近活动倒序', () => {
    const now = at('2026-07-29T12:00:00')
    const sections = sectionsAt(
      [{ updatedAt: '2026-07-29T08:00:00' }, { updatedAt: '2026-07-29T11:00:00' }],
      now,
    )

    expect(sections.at(0)?.members.map((member) => member.thread.updatedAt)).toEqual([
      '2026-07-29T11:00:00',
      '2026-07-29T08:00:00',
    ])
  })

  it('绝对文案是时刻的函数，不进时钟那一趟', () => {
    const dated = datedOf([{ updatedAt: '2026-07-29T11:00:00' }])

    expect(dated.at(0)?.absolute).not.toBeNull()
    expect(sectionsOf(dated, at('2026-07-29T12:00:00')).at(0)?.members.at(0)?.absolute).toBe(
      dated.at(0)?.absolute,
    )
  })

  it('一周以上给日期，不再报「多少天前」', () => {
    const now = at('2026-07-29T12:00:00')

    expect(formatElapsed(at('2026-07-01T12:00:00'), now)).not.toMatch(/\d+\s*天/)
  })

  it('不足一分钟由 Intl 说，不写死中文', () => {
    const now = at('2026-07-29T12:00:00')

    expect(formatElapsed(now - 5_000, now)).toBe(
      new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(0, 'second'),
    )
  })

  it('时长只有数量与单位，不带方向词，也不写死中文', () => {
    const now = at('2026-07-29T12:00:00')
    const unit = new Intl.NumberFormat(undefined, {
      style: 'unit',
      unit: 'minute',
      unitDisplay: 'narrow',
    })

    expect(formatElapsed(now - 31 * 60_000, now)).toBe(unit.format(31))
  })

  it('期限落在文案真正改变的那一刻，不是一个猜出来的周期', () => {
    const now = at('2026-07-29T12:00:00')
    /* 31 分 20 秒前：现在读作 31 分钟，下一次改口是它自己的第 32 分钟。 */
    const instant = now - (31 * 60_000 + 20_000)

    expect(horizonOf([instant], now)).toBe(instant + 32 * 60_000)
  })

  it('一天以上的行不报自己的期限，整屏仍在本地午夜改口', () => {
    const now = at('2026-07-29T12:00:00')

    expect(horizonOf([at('2026-07-20T08:00:00')], now)).toBe(at('2026-07-30T00:00:00'))
  })

  it('列表为空也要等一次午夜：分段会在那时改口', () => {
    const now = at('2026-07-29T12:00:00')

    expect(nextChangeIn([], now)).toBe(at('2026-07-30T00:00:00'))
  })

  it('整屏取最早的那个期限', () => {
    const now = at('2026-07-29T12:00:00')
    const fresh = now - 90_000
    const stale = at('2026-07-01T09:00:00')

    expect(horizonOf([stale], now)).toBe(at('2026-07-30T00:00:00'))
    /* 90 秒前读作 1 分钟，下一次改口是它自己的第 2 分钟 —— 写出那个时刻，
       而不是拿被测的实现再算一遍当作期望值。 */
    expect(horizonOf([stale, fresh], now)).toBe(fresh + 2 * 60_000)
  })

  it('无法解析的时刻归入更早，且不参与排序', () => {
    const now = at('2026-07-29T12:00:00')
    const [earlier] = sectionsAt([{ updatedAt: 'not-a-date' }], now)

    expect(earlier?.id).toBe('earlier')
    expect(earlier?.members.at(0)?.instant).toBeNaN()
    expect(earlier?.members.at(0)?.absolute).toBeNull()
  })
})
