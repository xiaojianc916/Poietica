import { describe, expect, it } from 'vitest'

import { formatElapsed, sectionsOf } from '../time'

const at = (iso: string) => Date.parse(iso)

describe('会话时间', () => {
  it('凌晨看昨晚的对话，属于昨天而不是今天', () => {
    const now = at('2026-07-29T00:30:00')
    const sections = sectionsOf([{ updatedAt: '2026-07-28T23:00:00' }], now)

    expect(sections.map((section) => section.id)).toEqual(['yesterday'])
  })

  it('段次序固定，与数据到达先后无关', () => {
    const now = at('2026-07-29T12:00:00')
    const sections = sectionsOf(
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
    const [today] = sectionsOf(
      [{ updatedAt: '2026-07-29T08:00:00' }, { updatedAt: '2026-07-29T11:00:00' }],
      now,
    )

    expect(today.members.map((member) => member.thread.updatedAt)).toEqual([
      '2026-07-29T11:00:00',
      '2026-07-29T08:00:00',
    ])
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

  it('无法解析的时刻归入更早，且不参与排序', () => {
    const now = at('2026-07-29T12:00:00')
    const sections = sectionsOf([{ updatedAt: 'not-a-date' }], now)

    expect(sections[0].id).toBe('earlier')
    expect(Number.isNaN(sections[0].members[0].instant)).toBe(true)
  })
})
