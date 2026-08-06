import type { AutomationTrigger } from '@poietica/ipc'
import { describe, expect, it } from 'vitest'

import {
  describeTrigger,
  joinInterval,
  MIN_INTERVAL_MINUTES,
  nextOccurrence,
  nextRunAfter,
  sameTrigger,
  splitInterval,
} from './automation'

const MINUTE = 60_000

describe('nextRunAfter', () => {
  it('manual 没有下一次', () => {
    expect(nextRunAfter({ kind: 'manual' }, Date.now())).toBeNull()
  })

  it('interval 严格按分钟数落在 from 之后', () => {
    const from = Date.UTC(2026, 0, 1, 12, 0, 0)

    expect(nextRunAfter({ kind: 'interval', everyMinutes: 90 }, from)).toBe(
      new Date(from + 90 * MINUTE).toISOString(),
    )
  })

  it('daily 落在本地墙钟的请求时刻，而不是绝对时间加法的结果', () => {
    /*
     * 本地构造：哪个时区跑，断言都成立；有夏令时的时区（这一天是 23 小时）
     * 里它能抓住旧的绝对时间实现 —— 那里旧实现会落到 10 点。
     */
    const from = new Date(2026, 2, 8, 12, 0, 0).getTime()
    const next = new Date(nextRunAfter({ kind: 'daily', atMinuteOfDay: 9 * 60 }, from) as string)

    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
    expect(next.getTime()).toBeGreaterThan(from)
  })

  it('daily 当天已过点则排到明天', () => {
    const from = new Date(2026, 0, 1, 10, 0, 0).getTime()
    const next = new Date(nextRunAfter({ kind: 'daily', atMinuteOfDay: 9 * 60 }, from) as string)

    expect(next.getDate()).toBe(2)
    expect(next.getHours()).toBe(9)
  })
})

describe('nextOccurrence', () => {
  const anchor = Date.UTC(2026, 0, 1, 9, 0, 0)

  it('interval 锚定计划时刻：错过几次也不换相位', () => {
    const trigger: AutomationTrigger = { kind: 'interval', everyMinutes: 60 }

    /* 计划是 9:00、10:00、11:00……；now 落在 11:30，下一次是 12:00 而不是 12:30。 */
    expect(nextOccurrence(trigger, anchor, anchor + 150 * MINUTE)).toBe(
      new Date(anchor + 180 * MINUTE).toISOString(),
    )
  })

  it('interval 锚点本身就是下一次时原样交回', () => {
    const trigger: AutomationTrigger = { kind: 'interval', everyMinutes: 60 }

    expect(nextOccurrence(trigger, anchor, anchor - 1)).toBe(new Date(anchor).toISOString())
  })

  it('daily 跨过关机错过的日子，相位不变', () => {
    const trigger: AutomationTrigger = { kind: 'daily', atMinuteOfDay: 9 * 60 }
    const start = new Date(2026, 0, 1, 9, 0, 0).getTime()
    const now = new Date(2026, 0, 4, 12, 0, 0).getTime()

    const next = new Date(nextOccurrence(trigger, start, now) as string)

    expect(next.getDate()).toBe(5)
    expect(next.getHours()).toBe(9)
  })

  it('manual 恒为 null', () => {
    expect(nextOccurrence({ kind: 'manual' }, anchor, anchor + 1000)).toBeNull()
  })
})

describe('splitInterval / joinInterval', () => {
  it('从大往小取第一个整除的单位', () => {
    expect(splitInterval(120)).toEqual({ size: 2, unit: 'hour' })
    expect(splitInterval(90)).toEqual({ size: 90, unit: 'minute' })
    expect(splitInterval(2880)).toEqual({ size: 2, unit: 'day' })
  })

  it('拼回去是同一张时刻表', () => {
    for (const everyMinutes of [1, 30, 60, 90, 120, 1440, 10080]) {
      const { size, unit } = splitInterval(everyMinutes)

      expect(joinInterval(size, unit)).toBe(everyMinutes)
    }
  })

  it('空与负的输入收在下限', () => {
    expect(joinInterval(Number(''), 'minute')).toBe(MIN_INTERVAL_MINUTES)
    expect(joinInterval(Number.NaN, 'minute')).toBe(MIN_INTERVAL_MINUTES)
    expect(joinInterval(-5, 'hour')).toBe(MIN_INTERVAL_MINUTES)
  })
})

describe('sameTrigger', () => {
  it('同种同参才算同一个', () => {
    expect(sameTrigger({ kind: 'manual' }, { kind: 'manual' })).toBe(true)
    expect(
      sameTrigger({ kind: 'interval', everyMinutes: 60 }, { kind: 'interval', everyMinutes: 60 }),
    ).toBe(true)
    expect(
      sameTrigger({ kind: 'interval', everyMinutes: 60 }, { kind: 'interval', everyMinutes: 61 }),
    ).toBe(false)
    expect(
      sameTrigger({ kind: 'daily', atMinuteOfDay: 540 }, { kind: 'daily', atMinuteOfDay: 541 }),
    ).toBe(false)
    expect(sameTrigger({ kind: 'manual' }, { kind: 'daily', atMinuteOfDay: 540 })).toBe(false)
  })
})

describe('describeTrigger', () => {
  it('三种触发条件各有一句人话', () => {
    expect(describeTrigger({ kind: 'manual' })).toBe('手动')
    expect(describeTrigger({ kind: 'interval', everyMinutes: 120 })).toBe('每 2 小时')
    expect(describeTrigger({ kind: 'daily', atMinuteOfDay: 9 * 60 })).toBe('每天 09:00')
  })
})
