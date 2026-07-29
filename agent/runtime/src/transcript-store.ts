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
 * 顺带解决路由：这里是全进程唯一的帧订阅者，也是唯一的 run 发起者，所以
 * "这一帧属于哪条对话"是它记下来的事实，而不是从帧里猜的 —— 帧上根本没有
 * 地址（run-contract.ts 的六个变体全是 { kind, seq, at, ... }）。同一条 ACP
 * 连接上最多只有一轮在飞，所以这个归属是精确的，不是启发式的。
 *
 * 真地址仍然欠着：信封里有 runId，在 platforms/desktop-ipc/src/agent.ts 的
 * module.listen 那一行被丢弃。补上之后，路由改成按 runId 查表，这里的其余部分
 * 一行都不用动。
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

function notify(key: string): void {
  for (const listener of listeners.get(key) ?? []) {
    listener()
  }

  for (const [from, to] of alias) {
    if (to === key) {
      for (const listener of listeners.get(from) ?? []) {
        listener()
      }
    }
  }
}

function evict(): void {
  while (held.size > HELD_KEYS) {
    const oldest = held.keys().next().value

    if (oldest === undefined) {
      return
    }

    held.delete(oldest)
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
/** 当前这一轮属于哪条对话。 */
let live: string | null = null

function route(event: RunEvent): void {
  if (live === null) {
    /*
     * 没有主人的帧不属于任何一条对话。
     *
     * 此前它会落进每一个挂载着的界面 —— 而正因为它落进了别人的转录，排版才会
     * 被别人的轮次搬动。丢掉是正确的：这个进程没有发起过它。
     */
    return
  }

  const owner = live
  const current = readTranscript(owner)

  put(owner, { ...current, timeline: applyRunEvent(current.timeline, event) })

  if (event.kind === 'run_finished' || event.kind === 'run_failed') {
    live = null
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
        alias.set(key, threadId)
        const drafted = held.get(key)

        if (drafted !== undefined) {
          held.delete(key)
          held.set(threadId, { ...drafted, owned: true })
        }
      } else {
        put(threadId, { ...readTranscript(threadId), owned: readTranscript(threadId).owned })
      }

      onUserMessage?.(threadId, text)

      /*
       * 归属在发出去之前就记下。
       *
       * 帧只可能在这之后到来，所以这里不存在"帧比归属先到"的窗口。
       */
      live = threadId

      return port.prompt({ threadId, text }).then((handle) => {
        cancels.set(threadId, handle.cancel)

        const held2 = readTranscript(threadId)

        if (held2.timeline.runId !== handle.runId) {
          put(threadId, { ...held2, timeline: { ...held2.timeline, runId: handle.runId } })
        }
      })
    })
    .catch((cause: unknown) => {
      if (live === resolveKey(key)) {
        live = null
      }

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
