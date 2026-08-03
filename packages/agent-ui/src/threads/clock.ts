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

/** 期限已经过去或算错时的兜底间隔：宁可晚一点，也不要退化成忙等。 */
const FLOOR = 250

/** 单次等待的上限：兜住 setTimeout 的 32 位截断，也兜住休眠期间的时钟跳变。 */
const CEILING = 86_400_000

const view = typeof document === 'undefined' ? undefined : document

const listeners = new Set<() => void>()

/*
 * 各消费者的期限，一个时刻。
 *
 * 此前这里存的是函数，理由写着「一次唤醒之后、React 重画之前，就要用新的 now
 * 重算下一个期限，函数做得到，数字做不到」。那件事确实要发生，但发生的地方不
 * 在这里：唤醒会通知每个 listener，useSyncExternalStore 让消费者重画，重画之后
 * useHorizon 本来就带着新的 now 重报一次。存函数换来的不是新鲜度 —— 换来的是
 * soonest() 每次结算都要把每个消费者的整张表重算一遍。
 *
 * 还有一笔反向代价，那段注释没提：函数每次渲染都是新引用，依赖数组无从写起，
 * 于是报期限的那个 effect 只能裸奔，每一次渲染都 set 一遍、plan 一遍。存时刻，
 * 表上的值就是可比较的，[at] 立刻成立：期限没变就不排表。
 */
const horizons = new Map<object, number>()

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

  for (const at of horizons.values()) {
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

/** 当前时刻。订阅这口时钟，它跳一次，这一屏就重画一次。 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, readNow, readNow)
}

/**
 * 报出「这一屏下一次会变的时刻」，时钟睡到那一刻为止。
 *
 * 与 useNow 分开，不是为了拆得细，是因为期限算得出来的前提是这一帧的投影已经
 * 做完，而投影要先拿到 now。合在一个 hook 里，期限就只能以回调的形式先交出去、
 * 等结算时再倒过来求值 —— soonest() 每次都要重扫全表，根子就在那个倒序上。
 * 分成两步，顺序就是渲染本身的顺序：取时刻、做投影、报期限。
 *
 * 期限是个数，所以依赖数组管得住它：同一个期限重报多少次都不排表。
 */
export function useHorizon(at: number): void {
  const key = useRef({}).current

  useEffect(() => {
    horizons.set(key, at)
    plan()

    return () => {
      horizons.delete(key)
      plan()
    }
  }, [at, key])
}
