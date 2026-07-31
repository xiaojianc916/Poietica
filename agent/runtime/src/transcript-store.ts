import type { AgentSessionPort, RunEvent } from '@poietica/agent-protocol'
import type { TimelineState } from '@poietica/agent-timeline'
import {
  appendLocalError,
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
 * 按对话规范化的状态、一个订阅入口、以及唯一的写入方。
 *
 * 它是一个对象，形制与同一层的 ThreadsStore 一致。此前这些字段是十二个模块级
 * 可变量：那样写没法在测试里拿到干净实例（模块随 import 求值一次，用例之间互相
 * 留痕，这也是 agent/runtime 至今零测试的结构性原因），而 attach 的那道
 * attachedTo === port 守卫会是进程级的 —— 它把"一个 store 订着一条线路"写成了
 * "一个进程订着一条线路"。held / alias / aliased / routes / orphans 本来就互相
 * 耦合（rename 同时写三张，evict 同时删三张），它们是一个对象的内部字段。
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

/** 留住多少条对话的转录。淘汰策略属于 store，这是它的本职。 */
const HELD_KEYS = 8

/** 同时记得多少轮的归属。一轮结束就删，这个上限只是兜底。 */
const ROUTED_RUNS = 64

/** 无主的帧最多攒多少。 */
const ORPHAN_FRAMES = 200

const NO_SESSION = '这个界面还没有接上助手会话，消息没有发送出去。'
const NO_THREAD = '无法开始新的对话，消息没有发送出去。'
const FAILURE_FALLBACK = '助手无法启动，或与它的连接已中断。'

export interface Transcript {
  readonly timeline: TimelineState
  /** 还在把这条对话取回来。 */
  readonly restoring: boolean
  /** 取回来过。 */
  readonly loaded: boolean
  /** 这条对话是这个进程刚开出来的：没有它这里没有的东西，不必去取。 */
  readonly owned: boolean
}

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

/*
 * 没有这条对话时给出的那一份。
 *
 * 必须是同一个对象：useSyncExternalStore 用引用相等判断有没有变，每次新建一个
 * 会让它认为状态每帧都在变。
 */
const EMPTY: Transcript = {
  timeline: createTimelineState(RUN_PLACEHOLDER),
  restoring: false,
  loaded: false,
  owned: false,
}

function describeFailure(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message
  }

  if (typeof cause === 'string' && cause.length > 0) {
    return cause
  }

  return FAILURE_FALLBACK
}

/*
 * 本地的事故记在本地。
 *
 * 起不来的 agent、送不出去的权限答复、读不回来的历史，都发生在任何持久化之前
 * 或之外，日志里没有对应的帧。此前这里伪造一帧 run_failed 交给 applyRunEvent，
 * 序号取 lastSeq 加一 —— 那个号是原生那侧发的，真的那一帧带着同一个号到达时会
 * 被去重判成重复而永久丢掉，而丢掉的可能正是 run_finished。
 */
function noteOn(timeline: TimelineState, cause: unknown, endsTurn: boolean): TimelineState {
  return appendLocalError(timeline, {
    message: describeFailure(cause),
    at: Date.now(),
    endsTurn,
  })
}

export class TranscriptStore {
  #held = new Map<string, Transcript>()

  #listeners = new Map<string, Set<() => void>>()

  /** 每条对话最近一轮的取消口。 */
  #cancels = new Map<string, () => Promise<void>>()

  /**
   * 草稿键 → 真对话 id。
   *
   * 入口那一格在说话之前不是任何一条对话，可它已经有转录了（人说的那句话）。
   * 乐观 id 对账是 store 的职责：这里给它一个别名，两个键读到同一份东西，界面
   * 拿到真 id 的那一帧因此没有任何空档。
   */
  #alias = new Map<string, string>()

  /** 真 id → 草稿键。alias 的反向索引：通知与淘汰都要按"谁在看"来问。 */
  #aliased = new Map<string, string>()

  #drafts = 0

  /**
   * 归属是一张按 runId 的表，不是"当前那一轮"。
   *
   * 上一版这里是一个可变量，记着此刻在飞的那一轮属于谁，靠"这个进程同时只有
   * 一轮在飞"这条约定活着。那是一条约定，不是一个事实：它由代码顺序维持
   * （在 prompt 之前赋值），任何一次并发、一次重试、一次未来的多 agent 都会让它
   * 悄悄对不上，而对不上的表现是帧落进别人的转录。
   *
   * 现在地址由线路给出（AgentSessionPort.subscribe 的第二个参数），归属因此是
   * 查表，错误状态在这套结构里无法被表达：查不到就是查不到，不会猜成手边那条。
   */
  #routes = new Map<string, string>()

  /**
   * 地址已知、主人还没登记的帧。
   *
   * 原生广播和 prompt 的返回是两条路，广播先到是常态而不是异常 —— 上一版靠"发
   * 出去之前先记下归属"掩盖了它。这里正面收着：按 runId 攒，登记那一刻补投，
   * 顺序不变。攒不下就丢最早的，因为一段无主的帧流不该把内存吃光。
   */
  #orphans = new Map<string, RunEvent[]>()

  #orphaned = 0

  #attachedTo: AgentSessionPort | null = null

  #detach: (() => void) | null = null

  /** 入口那一格的键。 */
  newDraft = (): string => {
    this.#drafts += 1

    return `draft:${String(this.#drafts)}`
  }

  read = (key: string): Transcript => this.#held.get(this.#resolveKey(key)) ?? EMPTY

  subscribe = (key: string, listener: () => void): (() => void) => {
    const set = this.#listeners.get(key) ?? new Set<() => void>()

    set.add(listener)
    this.#listeners.set(key, set)

    return () => {
      set.delete(listener)

      if (set.size === 0) {
        this.#listeners.delete(key)
      }
    }
  }

  /** 这一轮属于这条对话。在它之前到的帧在这里补投。 */
  claimRun = (runId: string, key: string): void => {
    this.#routes.set(runId, key)

    while (this.#routes.size > ROUTED_RUNS) {
      const oldest = this.#routes.keys().next().value

      if (oldest === undefined) {
        break
      }

      this.#routes.delete(oldest)
    }

    const waiting = this.#orphans.get(runId)

    if (waiting === undefined) {
      return
    }

    this.#dropOrphans(runId)

    for (const event of waiting) {
      this.#route(event, runId)
    }
  }

  /* ================= 一段历史送到 ================= */

  /**
   * 接上帧流。
   *
   * 只剩这一件事了。这里此前还要去取一次历史，而历史现在随「打开这条对话」
   * 一起回来 —— 打开它就是请 agent 把那条会话装载回来，装载期间它用
   * session/update 把整条重放一遍，那些帧就是历史本身。
   *
   * 那次取读的是本地日志，也就是同一段对话的第二份。两份之中只有一份是 agent
   * 手里那份；它们一旦分叉，屏幕上显示的是对的那份的赝品。所以这条取数路径
   * 没有被优化，它被取消了。
   */
  ensure = (port: AgentSessionPort): void => {
    this.#attach(port)
  }

  /** 正在把这条对话要回来。 */
  opening = (threadId: string): void => {
    const current = this.read(threadId)

    if (current.owned || current.loaded) {
      return
    }

    this.#put(threadId, { ...current, restoring: true })
  }

  /**
   * agent 把这条对话交回来了。
   *
   * events 在这里从 unknown 收窄成帧，全程只有这一处。断言而不是逐帧校验，
   * 与运行帧那条通道同一个判据：形状由平台那一侧定义，两条通道上的帧由同一个
   * acp_update 做出来。今天这一步藏在端口声明背后（loadThread 声明自己交回
   * RunEvent，而桥交出的是 unknown），挪到明处并不增加风险，只是让它可见。
   */
  adopt = (threadId: string, events: readonly unknown[]): void => {
    this.#put(threadId, {
      timeline: replayThreadEvents(RUN_PLACEHOLDER, events as readonly RunEvent[]),
      restoring: false,
      loaded: true,
      owned: false,
    })
  }

  /** 要不回来。这一条记在转录里，而不是记在会话设置那一格上。 */
  failed = (threadId: string, cause: unknown): void => {
    const latest = this.read(threadId)

    this.#put(threadId, {
      ...latest,
      restoring: false,
      timeline: noteOn(latest.timeline, cause, false),
    })
  }

  /* ================= 说一句话 ================= */

  send = ({ endpoint, identify, key, onUserMessage, port, text }: SendOptions): void => {
    const at = Date.now()
    const current = this.read(key)

    /* 人说的那句话先上屏，再去问 agent。失败的一轮丢掉的是答案，不是问题。 */
    this.#put(key, { ...current, timeline: appendUserMessage(current.timeline, text, at) })

    if (port === undefined) {
      this.#fail(key, new Error(NO_SESSION))

      return
    }

    this.#attach(port)

    const conversation =
      endpoint === null ? (identify?.() ?? Promise.resolve(null)) : Promise.resolve(endpoint)

    void conversation
      .then((threadId) => {
        if (threadId === null) {
          this.#fail(key, new Error(NO_THREAD))

          return undefined
        }

        /* 草稿在这一刻成为一条真对话：同一份转录，换一个名字。 */
        if (threadId !== key) {
          this.#rename(key, threadId)
        }

        onUserMessage?.(threadId, text)

        return port.prompt({ threadId, text }).then((handle) => {
          this.#cancels.set(threadId, handle.cancel)

          /*
           * 地址在这里落表。
           *
           * 比它先到的帧不会丢：那些帧带着同一个 runId 在 orphans 里等着，
           * claimRun 按原顺序补投。此前这里是"发出去之前先记下归属"，那不是解决
           * 竞态，那是把竞态藏进代码顺序里。
           */
          this.claimRun(handle.runId, threadId)

          const latest = this.read(threadId)

          if (latest.timeline.runId !== handle.runId) {
            this.#put(threadId, {
              ...latest,
              timeline: { ...latest.timeline, runId: handle.runId },
            })
          }
        })
      })
      .catch((cause: unknown) => {
        /* 没有"当前那一轮"要收拾了：这一轮从来没拿到过地址，也就从来没占过谁。 */
        this.#fail(key, cause)
      })
  }

  cancel = (key: string): void => {
    void this.#cancels.get(this.#resolveKey(key))?.()
  }

  resolvePermission = (
    port: AgentSessionPort | undefined,
    key: string,
    requestId: string,
    optionId: string,
  ): void => {
    if (port === undefined) {
      return
    }

    port.resolvePermission(requestId, optionId).catch((cause: unknown) => {
      this.#note(key, cause)
    })
  }

  /* ================= 内部 ================= */

  #resolveKey(key: string): string {
    return this.#alias.get(key) ?? key
  }

  /** 有界面正看着这条对话吗。草稿键上的订阅也算。 */
  #watched(real: string): boolean {
    const draft = this.#aliased.get(real)

    return this.#listeners.has(real) || (draft !== undefined && this.#listeners.has(draft))
  }

  #fire(key: string): void {
    for (const listener of this.#listeners.get(key) ?? []) {
      listener()
    }
  }

  /*
   * 通知走反向索引。
   *
   * 此前这里是 for (const [from, to] of alias) 找 to === key —— 把正向表当反向表
   * 用，于是流式输出的每一帧都线性扫一遍。
   */
  #notify(real: string): void {
    this.#fire(real)

    const draft = this.#aliased.get(real)

    if (draft !== undefined) {
      this.#fire(draft)
    }
  }

  /*
   * 淘汰只挑没人看着的。
   *
   * 此前是"插入序最早的那条"，不问有没有界面正订阅着它。8 条的上限、每帧调一次，
   * 于是一个正在看的转录会被挤掉，而代价是它下一帧重新去读日志（loaded 回到
   * false，ensure 重新取一次整条），界面上是一次 restoring 闪回。引用优先于时序，
   * 是浏览器与编辑器缓存的通行判据。
   *
   * 没人看的都淘汰完了还超，就让它超：内存上限不该以让屏幕上的东西重读为代价。
   * 订阅随组件卸载即解除，所以界面一关它立刻变成可淘汰，不会长期滞留。
   */
  #evict(): void {
    if (this.#held.size <= HELD_KEYS) {
      return
    }

    for (const key of [...this.#held.keys()]) {
      if (this.#held.size <= HELD_KEYS) {
        return
      }

      if (this.#watched(key)) {
        continue
      }

      this.#held.delete(key)

      /* 别名跟着走。此前 alias 只增不减，进程活多久它就长多久。 */
      const draft = this.#aliased.get(key)

      if (draft !== undefined) {
        this.#aliased.delete(key)
        this.#alias.delete(draft)
      }
    }
  }

  #put(key: string, next: Transcript): void {
    const real = this.#resolveKey(key)

    /* delete + set 把它挪到末尾：Map 的插入序就是 LRU 的顺序。 */
    this.#held.delete(real)
    this.#held.set(real, next)
    this.#evict()
    this.#notify(real)
  }

  /*
   * 草稿成为一条真对话：同一份转录，换一个名字。
   *
   * 此前这几行长在 send 里，直接 held.delete + held.set —— 全文件唯一绕过 put 的
   * 写入，于是 LRU 顺序、evict 和 notify 全部跳过了。快照换了身份而订阅者不知道，
   * 这违反 useSyncExternalStore 的契约；它此前只是被下游那次 put 盖住了。
   */
  #rename(from: string, to: string): void {
    this.#alias.set(from, to)
    this.#aliased.set(to, from)

    const drafted = this.#held.get(from)

    if (drafted === undefined) {
      return
    }

    this.#held.delete(from)
    this.#put(to, { ...drafted, owned: true })
  }

  /** 这一句问不出去，或者半路断了：这一轮到此为止。 */
  #fail(key: string, cause: unknown): void {
    const current = this.read(key)

    this.#put(key, { ...current, timeline: noteOn(current.timeline, cause, true) })
  }

  /*
   * 事故发生在那一轮之外。
   *
   * 权限答复送不出去 —— 那一轮还在跑。此前这里也走 #fail，于是一次送不出去的
   * 答复会把正在流式输出的一轮标成失败：toChatStatus 把它变成 error，输入框
   * 收摊、停止按钮消失，紧接着下一帧到达又把它翻回 running。
   */
  #note(key: string, cause: unknown): void {
    const current = this.read(key)

    this.#put(key, { ...current, timeline: noteOn(current.timeline, cause, false) })
  }

  #handOver(owner: string, event: RunEvent): void {
    const current = this.read(owner)

    this.#put(owner, { ...current, timeline: applyRunEvent(current.timeline, event) })
  }

  #hold(runId: string, event: RunEvent): void {
    const queue = this.#orphans.get(runId) ?? []

    queue.push(event)
    this.#orphans.set(runId, queue)
    this.#orphaned += 1

    while (this.#orphaned > ORPHAN_FRAMES) {
      const oldest = this.#orphans.keys().next().value

      if (oldest === undefined) {
        /* 表空了而计数没归零：走到这里本身就说明不变式已经破了。 */
        this.#orphaned = 0

        return
      }

      this.#dropOrphans(oldest)
    }
  }

  /*
   * 丢掉一段无主的帧，连同它在计数里的那一份。
   *
   * #orphaned 是各队列长度之和，此前由三处分别手工维护，其中 #route 那一处
   * 只删表不减数。它今天不发作，而且能证明为什么：#hold 只在查不到主人时
   * 入队，而 claimRun 是设路由与排空队列一起做的，所以 #route 走到终结分支
   * 时那个 runId 必然已经不在表里 —— 那是一个永远删不到东西的删除，紧挨着
   * 一个它一旦生效就会写坏的计数。收成一处之后，这个不变式不再依赖三个地方
   * 都记得。
   */
  #dropOrphans(runId: string): void {
    const queue = this.#orphans.get(runId)

    if (queue === undefined) {
      return
    }

    this.#orphans.delete(runId)
    this.#orphaned -= queue.length
  }

  #route(event: RunEvent, runId: string): void {
    const owner = this.#routes.get(runId)

    if (owner === undefined) {
      this.#hold(runId, event)

      return
    }

    this.#handOver(owner, event)

    if (event.kind !== 'run_finished' && event.kind !== 'run_failed') {
      return
    }

    this.#routes.delete(runId)
    this.#dropOrphans(runId)

    /*
     * 这一轮的取消口跟着这一轮走。
     *
     * 此前 #cancels 只增不减，是这个类里唯一没有上界的表：held 有 #evict，
     * routes 有 ROUTED_RUNS，orphans 有 ORPHAN_FRAMES，alias 跟着 held 走，
     * 只有它谁都不跟。
     *
     * 而它留下的不只是内存。一轮跑完之后那个闭包还在，停止键按在一条早已
     * 结束的对话上，仍然会照着旧 handle 发一次取消 —— 指向一个已经翻篇的
     * 会话。能取消的只有在飞的那一轮，所以表里也只该有在飞的那一轮。
     */
    this.#cancels.delete(owner)
  }

  /* 一个 store 订着一条线路。此前这道守卫是进程级的。 */
  #attach(port: AgentSessionPort): void {
    if (this.#attachedTo === port) {
      return
    }

    this.#detach?.()
    this.#attachedTo = port
    this.#detach = port.subscribe((event, runId) => {
      this.#route(event, runId)
    })
  }
}

/** 帧流全进程只有一条，所以路由它的 store 也只有一个。 */
export const transcripts = new TranscriptStore()
