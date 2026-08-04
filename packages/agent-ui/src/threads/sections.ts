/*
 * 会话列表的分段与文案。
 *
 * 与 clock.ts 分开，是因为两者一次 import 都不欠对方：时钟是「什么时候重画」，
 * 这里是「重画成什么样」。它们此前挤在一个 15KB 的 time.ts 里，那个文件同时
 * 是调度器、是 i18n、是派生管线 —— 三件事共用一个文件名，谁也说不清它属于哪层。
 *
 * 文案与绝对时刻交给 Intl：数量词、词序、语言是平台的事。分段按本地日历日算，
 * 不按经过毫秒算：凌晨 00:30 看昨晚 23:00 的对话，经过时间不足一天，但它属于昨天。
 */

import { DAY, HOUR, MINUTE, narrowUnit } from '../domain/duration'

/* 「不足一分钟」是一句话，让语言自己说，用 numeric: 'auto'。 */
const spoken = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/*
 * 其余各档是时长：只有数量和单位，没有方向。
 *
 * 格式器与毫秒常量都在 domain/duration —— 工具卡上的耗时读的是同一份。这三行
 * 此前是就地现造的 NumberFormat，与那边逐字相同。
 */
const elapsed = {
  day: narrowUnit('day'),
  hour: narrowUnit('hour'),
  minute: narrowUnit('minute'),
}
const sameYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const otherYear = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const exact = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })

function midnight(instant: number): number {
  const at = new Date(instant)

  at.setHours(0, 0, 0, 0)

  return at.getTime()
}

/** 相差几个本地日历日；跨夏令时的 23/25 小时天由取整吸收。 */
function calendarDays(instant: number, reference: number): number {
  return Math.round((midnight(reference) - midnight(instant)) / DAY)
}

/**
 * 一行的时间标签。
 *
 * 一周之内给时长，更久就给日期 —— GitHub、Slack、Linear 用的是同一道阶梯：
 * 时长在近处有用，在远处只剩噪声（「418 天」不解决任何问题）。未来时刻
 * （时钟偏差）读作「现在」，而不是负数。
 */
export function formatElapsed(instant: number, reference: number): string {
  const since = reference - instant

  if (since < MINUTE) {
    return spoken.format(0, 'second')
  }

  if (since < HOUR) {
    return elapsed.minute.format(Math.floor(since / MINUTE))
  }

  if (since < DAY) {
    return elapsed.hour.format(Math.floor(since / HOUR))
  }

  const days = calendarDays(instant, reference)

  if (days < 7) {
    return elapsed.day.format(days)
  }

  const stamp = new Date(instant)

  return stamp.getFullYear() === new Date(reference).getFullYear()
    ? sameYear.format(stamp)
    : otherYear.format(stamp)
}

/**
 * 下一个本地午夜。
 *
 * 用日历推进一天，而不是加 86_400_000：夏令时切换的那一天是 23 或 25 小时，
 * 加固定毫秒会把闹钟排错一小时。
 */
function nextMidnight(instant: number): number {
  const at = new Date(instant)

  at.setHours(0, 0, 0, 0)
  at.setDate(at.getDate() + 1)

  return at.getTime()
}

/*
 * 这一行的文案下一次会变的时刻 —— 与 formatElapsed 同一道阶梯，反着算。
 *
 * 分钟档在这一行自己的下一个整分钟变，小时档在下一个整小时变。一天以上没有
 * 属于自己的期限：它只在本地午夜改口，而午夜是整屏共同的边界，nextChangeIn
 * 无条件把它算进去（列表空着也要算）。此前这里交回 nextMidnight(reference) ——
 * 与那个初值逐字相等，于是每一行都白造一次 Date，算出一个必然被丢掉的候选。
 * 交回 Infinity 是把这句话说清楚：这一行自己不会变。
 *
 * 未来时刻（时钟偏差）读作「现在」，它会在自己的第一分钟到来时变，所以同样
 * 有确定的期限。
 *
 * 不导出：唯一的消费者是下面的 nextChangeIn —— 整屏的期限只能整屏地求。
 */
function nextChangeOf(instant: number, reference: number): number {
  const since = reference - instant

  if (since < MINUTE) {
    return instant + MINUTE
  }

  if (since < HOUR) {
    return instant + (Math.floor(since / MINUTE) + 1) * MINUTE
  }

  if (since < DAY) {
    return instant + (Math.floor(since / HOUR) + 1) * HOUR
  }

  return Number.POSITIVE_INFINITY
}

/**
 * 整屏下一次会变的时刻。
 *
 * 午夜无条件算进去：分段按本地日历日切，「今天」到点就得改叫「昨天」，哪
 * 怕没有任何一行到达自己的边界，哪怕列表是空的。
 *
 * 入参是已经分好段的结果，不是原始会话。sectionsOf 那一趟已经把每一行的
 * updatedAt 解析成 instant 了；此前这里从原始字符串重新 Date.parse 一遍，于是
 * 同一批字符串每帧被解析两次，而这一次还没有 useMemo 挡着 —— 改个名、按个键、
 * 父组件动一下，整张会话表就重新解析一轮。时刻是投影的产物，不该再算第二遍。
 */
export function nextChangeIn<T>(sections: readonly ThreadSection<T>[], reference: number): number {
  let found = nextMidnight(reference)

  for (const section of sections) {
    for (const member of section.members) {
      if (Number.isNaN(member.instant)) {
        continue
      }

      const at = nextChangeOf(member.instant, reference)

      if (at < found) {
        found = at
      }
    }
  }

  return found
}

/** 悬停时给出准确时刻：相对时间是概览，绝对时间才是事实。 */
export function formatAbsolute(instant: number): string {
  return exact.format(instant)
}

const PINNED = { id: 'pinned', label: '已固定' }

/*
 * 日期段。次序写在这张表里，而不是交给某个 Map 的插入顺序 —— 分段是一条固定
 * 的时间轴，不能因为数据先来后到就换位置。
 */
const DATED = [
  { id: 'today', label: '今天', within: 1 },
  { id: 'yesterday', label: '昨天', within: 2 },
  { id: 'week', label: '过去 7 天', within: 7 },
  { id: 'month', label: '过去 30 天', within: 30 },
  { id: 'earlier', label: '更早', within: Number.POSITIVE_INFINITY },
]

/* 输出次序：固定在最前，其余按这条时间轴。此前每次调用都现拼一次这张表。 */
const SECTIONS = [PINNED, ...DATED]

export interface DatedThread {
  readonly updatedAt: string
  readonly isPinned?: boolean
}

/**
 * 一行里不随墙上时间变化的那一半：时刻，以及它的准确说法。
 *
 * 分出来，是因为这两样都只是 updatedAt 的函数。它们此前与相对文案算在同一趟里
 * （sectionsOf），而那一趟的输入含 now —— 于是时钟每跳一次（有近处会话时是每分钟
 * 一次），整张列表就重跑一遍 Date.parse 和一遍 dateStyle: 'full' 的 DateTimeFormat，
 * 而后者只出现在悬停提示上，那一分钟里没有一个像素因它不同。
 *
 * 两级投影：数据变了算这一趟，时钟跳了只算下一趟。
 */
export interface DatedThreadMember<T> {
  readonly thread: T
  /** 解析过的时刻；无法解析时为 NaN。 */
  readonly instant: number
  /** 同一时刻的准确说法，给悬停与读屏；无法解析时为 null。 */
  readonly absolute: string | null
}

export function datedOf<T extends DatedThread>(
  threads: readonly T[],
): readonly DatedThreadMember<T>[] {
  return threads.map((thread) => {
    const instant = Date.parse(thread.updatedAt)

    return { absolute: Number.isNaN(instant) ? null : formatAbsolute(instant), instant, thread }
  })
}

export interface ThreadSectionMember<T> {
  readonly thread: T
  /** 解析过的时刻；无法解析时为 NaN。段内排序用它，画面不用。 */
  readonly instant: number
  /** 相对文案；时刻无法解析时为 null，此时该行不画时间。 */
  readonly elapsed: string | null
  /** 同一时刻的准确说法，给悬停与读屏。 */
  readonly absolute: string | null
}

export interface ThreadSection<T> {
  readonly id: string
  readonly label: string
  readonly members: readonly ThreadSectionMember<T>[]
}

function sectionIdOf(instant: number, reference: number): string {
  if (Number.isNaN(instant)) {
    return 'earlier'
  }

  const days = calendarDays(instant, reference)

  for (const section of DATED) {
    if (days < section.within) {
      return section.id
    }
  }

  return 'earlier'
}

function orderOf<T>(member: ThreadSectionMember<T>): number {
  return Number.isNaN(member.instant) ? 0 : member.instant
}

/*
 * 固定在最前，其余按本地日历日分段；段内按最近活动倒序。
 *
 * 入参是 datedOf 的结果，不是原始会话：这一趟只做随墙上时间变化的那一半 ——
 * 相对文案、分段与段内次序。时刻与绝对文案不随时钟变，它们在上一级算一次就够，
 * 此前跟着这一趟每分钟重算一遍整屏。
 */
export function sectionsOf<T extends DatedThread>(
  dated: readonly DatedThreadMember<T>[],
  reference: number,
): readonly ThreadSection<T>[] {
  const held = new Map<string, ThreadSectionMember<T>[]>()

  for (const { absolute, instant, thread } of dated) {
    const member: ThreadSectionMember<T> = {
      absolute,
      elapsed: Number.isNaN(instant) ? null : formatElapsed(instant, reference),
      instant,
      thread,
    }
    const id = thread.isPinned === true ? PINNED.id : sectionIdOf(instant, reference)
    const members = held.get(id)

    if (members === undefined) {
      held.set(id, [member])
    } else {
      members.push(member)
    }
  }

  const ordered: ThreadSection<T>[] = []

  for (const section of SECTIONS) {
    const members = held.get(section.id)

    if (members !== undefined) {
      members.sort((left, right) => orderOf(right) - orderOf(left))
      ordered.push({ id: section.id, label: section.label, members })
    }
  }

  return ordered
}
