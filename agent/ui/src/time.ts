import { useEffect, useRef, useSyncExternalStore } from 'react'

/*
 * 会话时间的唯一管线：一口时钟、一套文案、一套分段。
 *
 * 时间标签是随墙上时间变化的量，所以它必须由时钟驱动，不能在渲染时读一次
 * Date.now() —— 那样的标签只在别处状态碰巧变化时才刷新，看上去就是「莫名
 * 其妙老是改动」，中间几十分钟一动不动。订阅走 useSyncExternalStore，这是
 * React 对外部数据源的官方接线方式，而不是各组件自带 useState + useEffect
 * 各转各的表。
 *
 * 时钟不轮询。轮询周期是一个猜测，而且两头都错：它太慢（边界与周期不同相，
 * 文案最坏晚一整个周期才变），又太快（绝大多数次醒来，输出与上一帧逐字相
 * 同）。而"下一次文案会变的时刻"是可以由下面那道阶梯反推出来的已知量，所
 * 以这里是到期唤醒：消费者报出这一屏的期限，时钟睡到那一刻为止。GitHub 的
 * <relative-time>、Apple 的 Text(style: .relative)、Android 的 TextClock
 * 都是这么做的，没有一个是定周期轮询。
 *
 * 文案与绝对时刻交给 Intl：数量词、词序、语言是平台的事。行尾那一格给的是
 * 一段时长，不是一句话，所以走 NumberFormat 的 unit（narrow）——「31分钟」、
 * 「1小时」，en 下是 "31m"、"1h"。方向词不在这里说：它由「今天／昨天」那一行
 * 段标题说，每行再说一遍是重复。分段、排序、时钟这些核心仍然自己写。
 *
 * 分段按本地日历日算，不按经过毫秒算：凌晨 00:30 看昨晚 23:00 的对话，经过
 * 时间不足一天，但它属于昨天。
 */

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** 期限已经过去或算错时的兜底间隔：宁可晚一点，也不要退化成忙等。 */
const FLOOR = 250

/** 单次等待的上限：兜住 setTimeout 的 32 位截断，也兜住休眠期间的时钟跳变。 */
const CEILING = DAY

const view = typeof document === 'undefined' ? undefined : document

const listeners = new Set<() => void>()

/*
 * 各消费者的期限。存的是函数不是时刻：一次唤醒之后、React 重画之前，就要
 * 用新的 now 重算下一个期限，函数做得到，数字做不到。这也让调用点不必
 * useCallback —— 正确性不该依赖记忆化纪律。
 */
const horizons = new Map<object, (at: number) => number>()

let now = Date.now()
let timer: ReturnType<typeof setTimeout> | undefined
let scheduledFor = Number.POSITIVE_INFINITY
let pending = false

function awake(): boolean {
  return view === undefined || view.visibilityState === 'visible'
}

/** 这一刻起，最早会发生变化的时刻；没有人关心时是 Infinity，也就不排表。 */
function soonest(): number {
  if (listeners.size === 0 || !awake()) {
    return Number.POSITIVE_INFINITY
  }

  let found = Number.POSITIVE_INFINITY

  for (const horizon of horizons.values()) {
    const at = horizon(now)

    if (Number.isFinite(at) && at < found) {
      found = at
    }
  }

  return found
}

/*
 * 排表分两半：plan() 只标记「待排」，真正的结算在微任务里做一次。
 *
 * 期限只有在全体消费者都报完之后才算得准，所以「每报一次就结算一次」这个
 * 形状本身是错的：一次跳动会让每个消费者重画，每次重画都要重报期限，于是
 * C 个消费者要走 C+1 遍 soonest()，每遍再按行 Date.parse，前 C 个结果算完
 * 即被覆盖（早退判断在全部算完之后，省不下任何东西）。标记脏、批内合并、
 * 边界结算一次，是调度器的通行结构。微任务一定早于任何 setTimeout，所以
 * 合批不推迟唤醒。
 */
function plan() {
  if (pending) {
    return
  }

  pending = true
  queueMicrotask(settle)
}

function settle() {
  pending = false

  const at = soonest()

  if (at === scheduledFor) {
    return
  }

  scheduledFor = at

  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }

  if (at === Number.POSITIVE_INFINITY) {
    return
  }

  timer = setTimeout(fire, Math.min(Math.max(at - Date.now(), FLOOR), CEILING))
}

function fire() {
  timer = undefined
  scheduledFor = Number.POSITIVE_INFINITY
  now = Date.now()

  for (const listen of listeners) {
    listen()
  }

  plan()
}

/** 窗口重新可见时先补一帧，再重新排表：后台期间不烧 CPU，回来不落后。 */
function resync() {
  if (awake()) {
    fire()
  } else {
    plan()
  }
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen)

  if (listeners.size === 1) {
    view?.addEventListener('visibilitychange', resync)
    now = Date.now()
  }

  plan()

  return () => {
    listeners.delete(listen)

    if (listeners.size === 0) {
      view?.removeEventListener('visibilitychange', resync)
    }

    plan()
  }
}

const readNow = () => now

/**
 * 当前时刻。
 *
 * horizon 说的是「这一屏下一次会变的时刻」，时钟睡到那时才醒。每次渲染后
 * 重报一次：它由这次渲染的数据算出，缓存在闭包里就会过期。
 */
export function useNow(horizon: (at: number) => number): number {
  const key = useRef({}).current
  const moment = useSyncExternalStore(subscribe, readNow, readNow)

  useEffect(() => {
    horizons.set(key, horizon)
    plan()
  })

  useEffect(
    () => () => {
      horizons.delete(key)
      plan()
    },
    [key],
  )

  return moment
}

/* 「不足一分钟」是一句话，让语言自己说，用 numeric: 'auto'。 */
const spoken = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/* 其余各档是时长：只有数量和单位，没有方向。 */
const elapsed = {
  day: new Intl.NumberFormat(undefined, { style: 'unit', unit: 'day', unitDisplay: 'narrow' }),
  hour: new Intl.NumberFormat(undefined, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' }),
  minute: new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'narrow',
  }),
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

/**
 * 这一行的文案下一次会变的时刻 —— 与 formatElapsed 同一道阶梯，反着算。
 *
 * 分钟档在这一行自己的下一个整分钟变，小时档在下一个整小时变；一天以上只
 * 在本地午夜改口（包括跨过第七天那道坎、从时长改画日期）。未来时刻读作
 * 「现在」，它会在自己的第一分钟到来时变，所以同样有确定的期限。
 */
export function nextChangeOf(instant: number, reference: number): number {
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

  return nextMidnight(reference)
}

/**
 * 整屏下一次会变的时刻。
 *
 * 午夜无条件算进去：分段按本地日历日切，「今天」到点就得改叫「昨天」，哪
 * 怕没有任何一行到达自己的边界，哪怕列表是空的。
 */
export function nextChangeIn(threads: readonly DatedThread[], reference: number): number {
  let found = nextMidnight(reference)

  for (const thread of threads) {
    const instant = Date.parse(thread.updatedAt)

    if (Number.isNaN(instant)) {
      continue
    }

    const at = nextChangeOf(instant, reference)

    if (at < found) {
      found = at
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
 * 文案也在这一趟里算完。这个模块自称是「会话时间的唯一管线」，可文案此前
 * 是在调用点的 JSX 里逐行现算的，于是任何与时间无关的重画（改名态、父组件
 * 状态）都要把整屏的 Intl.DateTimeFormat（dateStyle: 'full'）重跑一遍，而它
 * 只用来做悬停提示。算在这里，它就只随 (threads, now) 变，被 useMemo 挡住。
 */
export function sectionsOf<T extends DatedThread>(
  threads: readonly T[],
  reference: number,
): readonly ThreadSection<T>[] {
  const held = new Map<string, ThreadSectionMember<T>[]>()

  for (const thread of threads) {
    const instant = Date.parse(thread.updatedAt)
    const unreadable = Number.isNaN(instant)
    const member: ThreadSectionMember<T> = {
      absolute: unreadable ? null : formatAbsolute(instant),
      elapsed: unreadable ? null : formatElapsed(instant, reference),
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
