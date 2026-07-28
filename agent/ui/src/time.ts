import { useSyncExternalStore } from 'react'

/*
 * 会话时间的唯一管线：一口时钟、一套文案、一套分段。
 *
 * 时间标签是随墙上时间变化的量，所以它必须由时钟驱动，不能在渲染时读一次
 * Date.now() —— 那样的标签只在别处状态碰巧变化时才刷新，看上去就是「莫名
 * 其妙老是改动」，中间几十分钟一动不动。这里只有一个 setInterval，全应用
 * 共享，窗口不可见时停摆；订阅走 useSyncExternalStore，这是 React 对外部
 * 数据源的官方接线方式，而不是各组件自带 useState + useEffect 各转各的表。
 *
 * 文案与绝对时刻交给 Intl：复数、词序、语言是平台的事。手写的字符串拼接
 * 既缺「前」字，也只有中文一种活法。分段、排序、时钟这些核心仍然自己写。
 *
 * 分段按本地日历日算，不按经过毫秒算：凌晨 00:30 看昨晚 23:00 的对话，经过
 * 时间不足一天，但它属于昨天。
 */

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** 半分钟足以让标签不落后到被看出来，又不至于让侧栏空转。 */
const TICK = 30_000

const view = typeof document === 'undefined' ? undefined : document

const listeners = new Set<() => void>()
let now = Date.now()
let timer: ReturnType<typeof setInterval> | undefined

function tick() {
  now = Date.now()

  for (const listen of listeners) {
    listen()
  }
}

function awake(): boolean {
  return view === undefined || view.visibilityState === 'visible'
}

function schedule() {
  if (timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }

  if (listeners.size > 0 && awake()) {
    timer = setInterval(tick, TICK)
  }
}

/** 窗口重新可见时先补一次，再继续按拍子走：后台期间不烧 CPU，回来不落后。 */
function resync() {
  if (awake()) {
    tick()
  }

  schedule()
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen)

  if (listeners.size === 1) {
    view?.addEventListener('visibilitychange', resync)
    now = Date.now()
    schedule()
  }

  return () => {
    listeners.delete(listen)

    if (listeners.size === 0) {
      view?.removeEventListener('visibilitychange', resync)
      schedule()
    }
  }
}

const readNow = () => now

/** 当前时刻，按拍子推进。组件读它，不必各自持有定时器。 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, readNow, readNow)
}

/* numeric: 'auto' 让「不足一分钟」由语言自己说；'always' 用于计数。 */
const spoken = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const counted = new Intl.RelativeTimeFormat(undefined, { numeric: 'always', style: 'narrow' })
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
 * 一周之内说「多久以前」，更久就给日期 —— GitHub、Slack、Linear 用的是同一
 * 道阶梯：相对时间在近处有用，在远处只剩噪声（「418 天前」不解决任何问题）。
 * 未来时刻（时钟偏差）读作「现在」，而不是负数。
 */
export function formatElapsed(instant: number, reference: number): string {
  const since = reference - instant

  if (since < MINUTE) {
    return spoken.format(0, 'second')
  }

  if (since < HOUR) {
    return counted.format(-Math.floor(since / MINUTE), 'minute')
  }

  if (since < DAY) {
    return counted.format(-Math.floor(since / HOUR), 'hour')
  }

  const days = calendarDays(instant, reference)

  if (days < 7) {
    return counted.format(-days, 'day')
  }

  const stamp = new Date(instant)

  return stamp.getFullYear() === new Date(reference).getFullYear()
    ? sameYear.format(stamp)
    : otherYear.format(stamp)
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

export interface DatedThread {
  readonly updatedAt: string
  readonly isPinned?: boolean
}

export interface ThreadSectionMember<T> {
  readonly thread: T
  /** 解析过的时刻；无法解析时为 NaN，此时该行不画时间。 */
  readonly instant: number
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
  const found = DATED.find((section) => days < section.within)

  return found === undefined ? 'earlier' : found.id
}

function orderOf<T>(member: ThreadSectionMember<T>): number {
  return Number.isNaN(member.instant) ? 0 : member.instant
}

/** 固定在最前，其余按本地日历日分段；段内按最近活动倒序。 */
export function sectionsOf<T extends DatedThread>(
  threads: readonly T[],
  reference: number,
): readonly ThreadSection<T>[] {
  const held = new Map<string, ThreadSectionMember<T>[]>()

  for (const thread of threads) {
    const instant = Date.parse(thread.updatedAt)
    const id = thread.isPinned === true ? PINNED.id : sectionIdOf(instant, reference)
    const members = held.get(id)

    if (members === undefined) {
      held.set(id, [{ instant, thread }])
    } else {
      members.push({ instant, thread })
    }
  }

  const ordered: ThreadSection<T>[] = []

  for (const section of [PINNED, ...DATED]) {
    const members = held.get(section.id)

    if (members !== undefined) {
      members.sort((left, right) => orderOf(right) - orderOf(left))
      ordered.push({ id: section.id, label: section.label, members })
    }
  }

  return ordered
}
