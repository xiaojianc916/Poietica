import type { AgentSessionPort, RunEvent } from '@poietica/agent-protocol'
import type { TimelineState } from '@poietica/agent-timeline'
import {
  appendUserMessage,
  applyRunEvent,
  createTimelineState,
  replayThreadEvents,
} from '@poietica/agent-timeline'

/*
 * 转录归这里，不归组件。
 *
 * 转录是后端状态：它来自一份本地加密日志，加上一条实时帧流。它此前活在
 * useAssistantSession 的 useState 里，于是每个挂载着的界面各持一份副本，各自
 * 订阅一次全量帧流，各自手搓一套缓存、游标、竞态守卫和乐观 id 对账 —— 那是在
 * 组件里重写了一个数据层。
 *
 * 这里是 React 官方为这件事给出的形状（useSyncExternalStore 的对侧）：一份
 * 按对话规范化的状态、一个订阅入口、以及唯一的写入方。同一个仓库里的
 * agent/ui/src/time.ts 已经是这个形状。
 *
 * 路由也在这里，而且是查表：线路上每一帧都带着它的 runId（见
 * AgentSessionPort.subscribe 的第二个参数），这里按 runId 找主人。帧上仍然没有
 * 地址（run-contract.ts 的六个变体全是 { kind, seq, at, ... }），地址在信封上。
 *
 * 那张欠条已经还了：runId 此前在 platforms/desktop-ipc/src/agent.ts 的
 * module.listen 那一行被丢弃，现在一路交到这里。于是"当前那一轮"这个概念不再
 * 存在 —— 它曾经是一条靠代码顺序维持的约定，而不是一个事实。
 */

/** 还没有真 run 之前，转录的占位轮次。 */
export const RUN_PLACEHOLDER = 'run_pending'

/** 一条对话打开时读多少轮，以及向上续读一次往前推多少。 */
export const WINDOW_RUNS = 40
const WINDOW_STEP = 40

/*
 * 留住多少条对话的转录。
 *
 * 淘汰策略属于 store，这是它的本职；此前它是一个模块级 Map 加一个常量，
 * 长在一个 React Hook 文件里。
 */
const HELD_KEYS = 8

export interface Transcript {
  readonly timeline: TimelineState
  /** 还在从日志里读。 */
  readonly restoring: boolean
  /** 这条对话一共有多少轮，由原生那侧数出来。 */
  readonly totalRuns: number
  /** 这份转录是按多少轮读出来的。 */
  readonly width: number
  /** 读过了。没读过的时候 totalRuns 不可信。 */
  readonly loaded: boolean
  /** 这条对话是这个进程刚开出来的：日志里没有它没有的东西，不必去读。 */
  readonly owned: boolean
}

/*
 * 没有这条对话时给出的那一份。
 *
 * 必须是同一个对象：useSyncExternalStore 用引用相等判断有没有变，每次新建一个
 * 会让它认为状态每帧都在变。
 */
const EMPTY: Transcript = {
  timeline: createTimelineState(RUN_PLACEHOLDER),
  restoring: false,
  totalRuns: 0,
  width: WINDOW_RUNS,
  loaded: false,
  owned: false,
}

const held = new Map<string, Transcript>()
const listeners = new Map<string, Set<() => void>>()
/** 正在读的宽度，按对话。一个对话同一时刻只读一次。 */
const reading = new Map<string, number>()
/** 每条对话最近一轮的取消口。 */
const cancels = new Map<string, () => Promise<void>>()
/**
 * 草稿键 → 真对话 id。
 *
 * 入口那一格在说话之前不是任何一条对话，可它已经有转录了（人说的那句话）。
 * 乐观 id 对账是 store 的职责：这里给它一个别名，两个键读到同一份东西，界面
 * 拿到真 id 的那一帧因此没有任何空档。
 */
const alias = new Map<string, string>()

let drafts = 0

/** 入口那一格的键。 */
export function newDraftKey(): string {
  drafts += 1

  return `draft:${String(drafts)}`
}

function resolveKey(key: string): string {
  return alias.get(key) ?? key
}

/** 真 id → 草稿键。alias 的反向索引:通知与淘汰都要按"谁在看"来问。 */
const aliased = new Map<string, string>()

/** 有界面正看着这条对话吗。草稿键上的订阅也算。 */
function watched(real: string): boolean {
  const draft = aliased.get(real)

  return listeners.has(real) || (draft !== undefined && listeners.has(draft))
}

function fire(key: string): void {
  for (const listener of listeners.get(key) ?? []) {
    listener()
  }
}

/*
 * 通知走反向索引。
 *
 * 此前这里是 for (const [from, to] of alias) 找 to === key —— 把正向表当反向表
 * 用,于是流式输出的每一帧都线性扫一遍。
 */
function notify(real: string): void {
  fire(real)

  const draft = aliased.get(real)

  if (draft !== undefined) {
    fire(draft)
  }
}

/*
 * 淘汰只挑没人看着的。
 *
 * 此前是"插入序最早的那条",不问有没有界面正订阅着它。8 条的上限、每帧调一次,
 * 于是一个正在看的转录会被挤掉,而代价是它下一帧重新去读日志(loaded 回到 false,
 * ensureTranscript 重放 40 轮),界面上是一次 restoring 闪回。引用优先于时序,
 * 是浏览器与编辑器缓存的通行判据。
 *
 * 没人看的都淘汰完了还超,就让它超:内存上限不该以让屏幕上的东西重读为代价。
 * 订阅随组件卸载即解除,所以界面一关它立刻变成可淘汰,不会长期滞留。
 */
function evict(): void {
  if (held.size <= HELD_KEYS) {
    return
  }

  for (const key of [...held.keys()]) {
    if (held.size <= HELD_KEYS) {
      return
    }

    if (watched(key)) {
      continue
    }

    held.delete(key)

    /* 别名跟着走。此前 alias 只增不减,进程活多久它就长多久。 */
    const draft = aliased.get(key)

    if (draft !== undefined) {
      aliased.delete(key)
      alias.delete(draft)
    }
  }
}

function put(key: string, next: Transcript): void {
  const real = resolveKey(key)

  /* delete + set 把它挪到末尾：Map 的插入序就是 LRU 的顺序。 */
  held.delete(real)
  held.set(real, next)
  evict()
  notify(real)
}

/*
 * 草稿成为一条真对话:同一份转录,换一个名字。
 *
 * 此前这几行长在 sendToTranscript 里,直接 held.delete + held.set —— 全文件唯一
 * 绕过 put 的写入,于是 LRU 顺序、evict 和 notify 全部跳过了。快照换了身份而订阅
 * 者不知道,这违反 useSyncExternalStore 的契约;它此前只是被下游那次 put 盖住了。
 */
function rename(from: string, to: string): void {
  alias.set(from, to)
  aliased.set(to, from)

  const drafted = held.get(from)

  if (drafted === undefined) {
    return
  }

  held.delete(from)
  put(to, { ...drafted, owned: true })
}

export function readTranscript(key: string): Transcript {
  return held.get(resolveKey(key)) ?? EMPTY
}

export function subscribeTranscript(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>()

  set.add(listener)
  listeners.set(key, set)

  return () => {
    set.delete(listener)

    if (set.size === 0) {
      listeners.delete(key)
    }
  }
}

/*
 * 本地失败也是一次失败的轮次。
 *
 * 起不来的 agent、答给一个已经不等的提问，都在任何持久化之前就失败了，日志里
 * 没有对应的帧。reducer 已经会画失败的轮次，所以把事实交给它，而不是伸手去改
 * 状态的形状。
 */
const FAILURE_FALLBACK = '助手无法启动，或与它的连接已中断。'

function describeFailure(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message
  }

  if (typeof cause === 'string' && cause.length > 0) {
    return cause
  }

  return FAILURE_FALLBACK
}

export function failTranscript(key: string, cause: unknown): void {
  const current = readTranscript(key)

  put(key, {
    ...current,
    timeline: applyRunEvent(current.timeline, {
      kind: 'run_failed',
      seq: current.timeline.lastSeq + 1,
      at: Date.now(),
      message: describeFailure(cause),
    }),
  })
}

/* ================= 帧的归属 ================= */

let attachedTo: AgentSessionPort | null = null
let detach: (() => void) | null = null

/*
 * 归属是一张按 runId 的表，不是"当前那一轮"。
 *
 * 上一版这里是一个模块级可变量，记着此刻在飞的那一轮属于谁，靠"这个进程同时
 * 只有一轮在飞"这条约定活着。那是一条约定，不是一个事实：它由代码顺序维持
 * （在 prompt 之前赋值），任何一次并发、一次重试、一次未来的多 agent 都会让它
 * 悄悄对不上，而对不上的表现是帧落进别人的转录 —— 也就是我们查了很久的那种
 * 排版被别人的轮次搬动。
 *
 * 现在地址由线路给出（AgentSessionPort.subscribe 的第二个参数），归属因此是
 * 查表，错误状态在这套结构里无法被表达：查不到就是查不到，不会猜成手边那条。
 */
const routes = new Map<string, string>()

/** 同时记得多少轮的归属。一轮结束就删，这个上限只是兜底。 */
const ROUTED_RUNS = 64

/*
 * 地址已知、主人还没登记的帧。
 *
 * 原生广播和 prompt 的返回是两条路，广播先到是常态而不是异常 —— 上一版靠"发
 * 出去之前先记下归属"掩盖了它。这里正面收着：按 runId 攒，登记那一刻补投，
 * 顺序不变。攒不下就丢最早的，因为一段无主的帧流不该把内存吃光。
 */
const orphans = new Map<string, RunEvent[]>()
const ORPHAN_FRAMES = 200
let orphaned = 0

function handOver(owner: string, event: RunEvent): void {
  const current = readTranscript(owner)

  put(owner, { ...current, timeline: applyRunEvent(current.timeline, event) })
}

function hold(runId: string, event: RunEvent): void {
  const queue = orphans.get(runId) ?? []

  queue.push(event)
  orphans.set(runId, queue)
  orphaned += 1

  while (orphaned > ORPHAN_FRAMES) {
    const first = orphans.keys().next().value

    if (first === undefined) {
      orphaned = 0

      return
    }

    orphaned -= orphans.get(first)?.length ?? 0
    orphans.delete(first)
  }
}

function route(event: RunEvent, runId: string): void {
  const owner = routes.get(runId)

  if (owner === undefined) {
    hold(runId, event)

    return
  }

  handOver(owner, event)

  if (event.kind === 'run_finished' || event.kind === 'run_failed') {
    routes.delete(runId)
    orphans.delete(runId)
  }
}

/** 这一轮属于这条对话。在它之前到的帧在这里补投。 */
export function claimRun(runId: string, key: string): void {
  routes.set(runId, key)

  while (routes.size > ROUTED_RUNS) {
    const oldest = routes.keys().next().value

    if (oldest === undefined) {
      break
    }

    routes.delete(oldest)
  }

  const waiting = orphans.get(runId)

  if (waiting === undefined) {
    return
  }

  orphans.delete(runId)
  orphaned -= waiting.length

  for (const event of waiting) {
    route(event, runId)
  }
}

function attach(port: AgentSessionPort): void {
  if (attachedTo === port) {
    return
  }

  detach?.()
  attachedTo = port
  detach = port.subscribe(route)
}

/* ================= 读一段历史 ================= */

export function ensureTranscript(port: AgentSessionPort, key: string, width: number): void {
  attach(port)

  const loadThread = port.loadThread

  if (loadThread === undefined) {
    return
  }

  const current = readTranscript(key)

  /* 自己刚开出来的那条，日志里没有它没有的东西。 */
  if (current.owned) {
    return
  }

  /* 读过、而且读得够宽了，就不再读第二遍。 */
  if (current.loaded && current.width >= width) {
    return
  }

  /* 同一个宽度已经在飞。竞态守卫是 store 的一张表，不是每个界面各揣一个计数器。 */
  if (reading.get(key) === width) {
    return
  }

  reading.set(key, width)
  put(key, { ...current, restoring: !current.loaded, width })

  void loadThread(key, width)
    .then((window) => {
      if (reading.get(key) !== width) {
        return
      }

      reading.delete(key)

      put(key, {
        timeline: replayThreadEvents(RUN_PLACEHOLDER, window.events),
        restoring: false,
        totalRuns: window.totalRuns,
        width,
        loaded: true,
        owned: false,
      })
    })
    .catch((cause: unknown) => {
      if (reading.get(key) !== width) {
        return
      }

      reading.delete(key)
      put(key, { ...readTranscript(key), restoring: false })
      failTranscript(key, cause)
    })
}

/*
 * 人读到了这段历史的上边界：把窗口往前推一段。
 *
 * 三道闸门都是事实而不是标志位：没读出来过就不知道上面有没有；totalRuns 是原生
 * 那侧数出来的；有一段还在飞的时候不叠着再要一段。所以滚动每一帧都调它是安全的。
 */
export function reachTranscriptStart(port: AgentSessionPort, key: string): void {
  const current = readTranscript(key)

  if (!current.loaded || current.totalRuns <= current.width || reading.has(key)) {
    return
  }

  ensureTranscript(port, key, current.width + WINDOW_STEP)
}

/* ================= 说一句话 ================= */

const NO_SESSION = '这个界面还没有接上助手会话，消息没有发送出去。'
const NO_THREAD = '无法开始新的对话，消息没有发送出去。'

export interface SendOptions {
  readonly port: AgentSessionPort | undefined
  /** 这一格现在的键：真对话 id，或入口那一格的草稿键。 */
  readonly key: string
  /** 这一格已经是哪条对话；入口那一格是 null。 */
  readonly endpoint: string | null
  readonly text: string
  readonly identify?: (() => Promise<string | null>) | undefined
  readonly onUserMessage?: ((threadId: string, text: string) => void) | undefined
}

export function sendToTranscript({
  endpoint,
  identify,
  key,
  onUserMessage,
  port,
  text,
}: SendOptions): void {
  const at = Date.now()
  const current = readTranscript(key)

  /* 人说的那句话先上屏，再去问 agent。失败的一轮丢掉的是答案，不是问题。 */
  put(key, { ...current, timeline: appendUserMessage(current.timeline, text, at) })

  if (port === undefined) {
    failTranscript(key, new Error(NO_SESSION))

    return
  }

  attach(port)

  const conversation =
    endpoint === null ? (identify?.() ?? Promise.resolve(null)) : Promise.resolve(endpoint)

  void conversation
    .then((threadId) => {
      if (threadId === null) {
        failTranscript(key, new Error(NO_THREAD))

        return undefined
      }

      /* 草稿在这一刻成为一条真对话：同一份转录，换一个名字。 */
      if (threadId !== key) {
        rename(key, threadId)
      }

      onUserMessage?.(threadId, text)

      return port.prompt({ threadId, text }).then((handle) => {
        cancels.set(threadId, handle.cancel)

        /*
         * 地址在这里落表。
         *
         * 比它先到的帧不会丢：那些帧带着同一个 runId 在 orphans 里等着，
         * claimRun 按原顺序补投。此前这里是"发出去之前先记下归属"，那不是解决
         * 竞态，那是把竞态藏进代码顺序里。
         */
        claimRun(handle.runId, threadId)

        const latest = readTranscript(threadId)

        if (latest.timeline.runId !== handle.runId) {
          put(threadId, { ...latest, timeline: { ...latest.timeline, runId: handle.runId } })
        }
      })
    })
    .catch((cause: unknown) => {
      /* 没有"当前那一轮"要收拾了：这一轮从来没拿到过地址，也就从来没占过谁。 */
      failTranscript(key, cause)
    })
}

export function cancelTranscript(key: string): void {
  void cancels.get(resolveKey(key))?.()
}

export function resolveTranscriptPermission(
  port: AgentSessionPort | undefined,
  key: string,
  requestId: string,
  optionId: string,
): void {
  if (port === undefined) {
    return
  }

  port.resolvePermission(requestId, optionId).catch((cause: unknown) => {
    failTranscript(key, cause)
  })
}
