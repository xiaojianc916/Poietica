import type { AgentSessionPort, RunEvent, ThreadHistory } from '@poietica/acp'
import type { TimelineState } from '@poietica/agent-timeline'
import {
  appendLocalError,
  appendUserMessage,
  applyRunEvents,
  createTimelineState,
  replayThreadEvents,
} from '@poietica/agent-timeline'
import { describeFailure } from './describe-failure'

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
 * 留痕，这也是 packages/agent-session 至今零测试的结构性原因），而 attach 的那道
 * attachedTo === port 守卫会是进程级的 —— 它把"一个 store 订着一条线路"写成了
 * "一个进程订着一条线路"。held / alias / aliased / routes / orphans 本来就互相
 * 耦合（rename 同时写三张，forget 同时删三张），它们是一个对象的内部字段。
 *
 * 路由是一次查表，键是会话号：线路上每一帧都带着它（见 recorder.rs 的 RecordedEvent，
 * 六种帧无一例外），而"这条会话属于哪条对话"在打开这条对话时就登记好了（见
 * route，由 ThreadsStore 在拿到 ThreadRecord.sessionId 的那一刻交过来）。
 *
 * 地址因此先于帧存在，"无主的帧"不再是一种正常状态：此前键是轮次号，它由
 * prompt 的答复带回来而原生广播先到，于是这里养着一整套排队、补投、计数与
 * 上限，只为等一个本来就已经在手里的东西。
 */

/** 入口那一格的键前缀。它还不是一条对话，所以也没有什么可停的。 */
const DRAFT = 'draft:'

const NO_SESSION = '这个界面还没有接上助手会话，消息没有发送出去。'
const NO_THREAD = '无法开始新的对话，消息没有发送出去。'

/* 经过要不回来的三种说法。它们写进转录，因为人是在转录里找这段经过的。 */
const OTHER_AGENT = '这段对话由另一个 agent 保管，当前这个打不开它。'

const NOT_SUPPORTED = '当前 agent 不支持装载旧会话，这段对话的经过取不回来。'

const FORGOTTEN = 'agent 那侧已经没有这段会话，经过取不回来了。'

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
  timeline: createTimelineState(),
  restoring: false,
  loaded: false,
  owned: false,
}

/*
 * 「还没轮到下一句」的全部两种形态。
 *
 * 判据是 RunStatus 本身（run-contract.ts 的六档），不是另立一个布尔或另记一张表：
 * 转录已经逐帧维护着这一格，useAssistantSession 的 toChatStatus 读的也是它。
 */
function running(status: TimelineState['status']): boolean {
  return status === 'running' || status === 'awaiting_permission'
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

/*
 * 空白得说明来由。
 *
 * 一段取不回来的经过，和一条本来就没说过话的对话，在屏幕上是同一片空白——而它们
 * 不是同一件事。此前这一层分辨不出来，因为原生侧交过来的只是一个空数组：六种
 * 情况一个形状。现在它会说清是哪一种（见 AgentHistory），这里只负责把三种坏
 * 消息翻成一句人话；其余三种没有损失，什么都不加。
 */
function lossOf(history: ThreadHistory): string | null {
  if (history.state !== 'unavailable') {
    return null
  }

  switch (history.reason) {
    case 'otherAgent':
      return history.owner === null
        ? OTHER_AGENT
        : `这段对话由 ${history.owner} 保管，当前 agent 打不开它。`
    case 'notSupported':
      return NOT_SUPPORTED
    default:
      return FORGOTTEN
  }
}

/**
 * 什么时候把「变了」告诉界面。
 */
export type Paint = (flush: () => void) => void

/*
 * 默认按屏幕的节拍。
 *
 * 一次回答是几千帧，屏幕一秒画六十次。把每一帧都当成一次「该重画了」，是
 * 拿几千趟投影、比对与布局去换六十张画面 —— 多出来的那些趟，画面上没有任何
 * 一个像素因它们而不同。
 *
 * 推迟的只有「去看一眼」这个动作：状态本身仍然是同步写进去的，read 任何时刻
 * 交出的都是当前那一份。useSyncExternalStore 的契约要的正是这个 —— 快照必须
 * 准，通知只要不漏，它从来没有要求「立刻」。
 *
 * 没有屏幕的地方（测试、SSR）退回微任务：同一句语义（下一个空档），换一个时基。
 */
const onNextPaint: Paint = (flush) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      flush()
    })

    return
  }

  queueMicrotask(flush)
}

export class TranscriptStore {
  readonly #paint: Paint

  /** 这一拍里变过的对话。同一条变一百次也只叫醒一次。 */
  #dirty = new Set<string>()

  #waiting = false

  constructor(paint: Paint = onNextPaint) {
    this.#paint = paint
  }

  /**
   * 对话 → 它的转录。这张表没有上限，也不需要有。
   *
   * 它此前带着一个 8 条的 LRU。那道上限封不住内存 —— 同一个进程里按对话记的
   * 表另有四张（#alias / #aliased / #routes / #pending），加上 ThreadsStore 的
   * 四张（#asked / #sessions / #actual / #tried），全部只随删除而缩。它唯一确
   * 实做到的事是制造一条丢内容的路径：一条界面已经关掉的对话被淘汰之后，
   * ThreadsStore.adopt 见 #asked 里有它就直接返回、永不重取，于是切回去是一片
   * 空白，而 restoring 与 loaded 都是 false，连「正在取」都不显示。
   *
   * 转录的生命周期就是对话的生命周期。回收因此只有一个出口：forget，由
   * ThreadsStore.remove 在这条对话真的不存在时调用。
   */
  #held = new Map<string, Transcript>()

  #listeners = new Map<string, Set<() => void>>()

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
   * 会话号 → 对话。归属只有这一张表。
   *
   * 它在打开一条对话时就写好了（route），而帧是此后才发生的事，所以查不到主人
   * 是一种真正的异常，不是一段要等的时差。一条会话跨越它上面的每一轮，这张表
   * 因此不随一轮结束而删；它的规模等于这个进程打开过几条对话，与 ThreadsStore
   * 的 #sessions 同阶。
   */
  #routes = new Map<string, string>()

  /**
   * 收到了、还没折进转录的帧，按对话攒着。
   *
   * 每折一帧要复制一遍整条 items（见 timeline-reducer 的 draftOf）。所以帧先攒，
   * 折叠推迟到真的有人要看的那一刻：下一拍，或者任何一次同步读。
   */
  #pending = new Map<string, RunEvent[]>()

  /** 想知道「某条对话空下来了」的人。 */
  #idle = new Set<(threadId: string) => void>()

  #attachedTo: AgentSessionPort | null = null

  #detach: (() => void) | null = null

  /** 入口那一格的键。 */
  newDraft = (): string => {
    this.#drafts += 1

    return `${DRAFT}${String(this.#drafts)}`
  }

  /**
   * 这一格现在是什么样子。一次查表，什么都不改。
   *
   * 这就是 useSyncExternalStore 的 getSnapshot，而 React 在渲染期调用它 ——
   * 契约要求它是纯读取。此前它走 #settle：折叠会删 #pending、写 #held，还会
   * 同步广播 #idle（ThreadsStore 就挂在那上面）。也就是说一次渲染会变更两个
   * store。那一刀此前只写在 #write 的注释里，代码没跟上。
   *
   * 折叠因此只剩两个位置，都在读之外：#flush（叫醒订阅者之前折完）与 #now
   * （内部写路径要的是最新那一份）。帧进 → 折叠 → 通知 → 读，单向，不回头。
   */
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

  /**
   * 这条会话属于这条对话。
   *
   * 由握着这个事实的那一方交过来（ThreadsStore 在打开的答复里拿到它），所以
   * 这里不猜也不问。同一条会话重复登记是幂等的。
   */
  route = (sessionId: string, key: string): void => {
    this.#routes.set(sessionId, key)
  }

  /**
   * 这条对话不存在了。
   *
   * 这是转录唯一的回收出口：转录的生命周期就是对话的生命周期。
   *
   * 攒着还没折进去的帧也在这里作废。漏掉它们不只是漏一格内存 —— 删掉一条正在
   * 流式输出的对话之后，界面被叫醒、read 走到 #settle，那批帧会被折进一个空
   * 转录再写回 #held，被删掉的东西就这么回到了屏幕上。
   *
   * 删完就通知：还挂着的界面下一帧读到的是 EMPTY，不是一份不存在的东西。
   */
  forget = (key: string): void => {
    const real = this.#resolveKey(key)
    const draft = this.#aliased.get(real)

    this.#held.delete(real)
    this.#pending.delete(real)
    this.#aliased.delete(real)
    this.#dirty.delete(real)

    if (draft !== undefined) {
      this.#alias.delete(draft)
    }

    /* 会话号那张表也是按对话记的：留着它，死会话的帧仍会找到主人。 */
    for (const [sessionId, owner] of this.#routes) {
      if (owner === real) {
        this.#routes.delete(sessionId)
      }
    }

    this.#fire(real)

    if (draft !== undefined) {
      this.#fire(draft)
    }
  }

  /** 这条对话此刻有没有一轮在飞。 */
  busy = (key: string): boolean => running(this.#now(key).timeline.status)

  /** 某条对话从忙变闲的那一刻；交回取消订阅的办法。 */
  onIdle = (listener: (threadId: string) => void): (() => void) => {
    this.#idle.add(listener)

    return () => {
      this.#idle.delete(listener)
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
    const current = this.#now(threadId)

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
   * acp_update 做出来 —— 重放的帧与实时的帧是同一批东西，走同一条重放函数。
   *
   * 收窄发生在明处，而不是藏在某个端口声明的返回类型里：声明成 RunEvent 而
   * 实际交出 unknown，那是一次没人看得见的断言。这里看得见。
   *
   * 交回来的可能是空的，而空有六种由来（history）。其中三种是损失：换了 agent、
   * 这个 agent 不装载旧会话、agent 那侧已经不记得它。损失走的是本地事故那条既有
   * 通道，和「权限答复送不出去」同一条——它同样发生在任何持久化之外，日志里没有
   * 对应的帧。endsTurn 为假：这不是某一轮失败了，这是这段历史没回来。
   */
  adopt = (threadId: string, events: readonly unknown[], history: ThreadHistory): void => {
    const replayed = replayThreadEvents(events as readonly RunEvent[])
    const lost = lossOf(history)

    this.#put(threadId, {
      timeline: lost === null ? replayed : noteOn(replayed, lost, false),
      restoring: false,
      loaded: true,
      owned: false,
    })
  }

  /** 要不回来。这一条记在转录里，而不是记在会话设置那一格上。 */
  failed = (threadId: string, cause: unknown): void => {
    const latest = this.#now(threadId)

    this.#put(threadId, {
      ...latest,
      restoring: false,
      timeline: noteOn(latest.timeline, cause, false),
    })
  }

  /* ================= 说一句话 ================= */

  send = ({ endpoint, identify, key, onUserMessage, port, text }: SendOptions): void => {
    const at = Date.now()
    const current = this.#now(key)

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
          /*
           * 地址早就在表里了：这条对话打开的那一刻就登记过（route）。
           *
           * 这里再写一次是同一个事实写进同一张表 —— 答复里的会话号是原生侧
           * 此刻真正在用的那一条，而一条刚建出来的对话在开口之前还没有会话
           * 号可登记。它是幂等的，不是补救。
           */
          this.route(handle.sessionId, threadId)
        })
      })
      .catch((cause: unknown) => {
        /* 没有"当前那一轮"要收拾了：这一轮从来没拿到过地址，也就从来没占过谁。 */
        this.#fail(key, cause)
      })
  }

  /**
   * 停掉这条对话上正在跑的那一轮。
   *
   * 点名一条对话就够了，地址在端口那一侧。此前这里存着上一次 prompt 交回来的
   * 取消闭包：一张只增不减的表，一轮跑完之后闭包还留着，停止键按在一条早已
   * 结束的对话上仍然会照着它发一次取消 —— 指向一个已经翻篇的轮次。
   *
   * 入口那一格在开口之前还不是任何一条对话。它没有轮次在飞，也没有会话可发。
   */
  cancel = (key: string): void => {
    const threadId = this.#resolveKey(key)

    if (threadId.startsWith(DRAFT)) {
      return
    }

    void this.#attachedTo?.cancel(threadId)
  }

  /* 线路只有一条（#attachedTo），答复的地址不必由调用方再交一次 —— 与 cancel 同一个入口。 */
  resolvePermission = (key: string, requestId: string, optionId: string): void => {
    const port = this.#attachedTo

    if (port === null) {
      return
    }

    port.resolvePermission(requestId, optionId).catch((cause: unknown) => {
      this.note(key, describeFailure(cause))
    })
  }

  /**
   * 一件本地事故，记进这条对话的转录。
   *
   * 它是本地事故唯一的公开入口：界面层此前把「连不上 agent」画在输入框顶上,
   * 那是第二条报错通道 —— 同一类事实按它从哪儿来决定长什么样。报错只有一种
   * 形态,就是转录里的那一条横线。
   *
   * endsTurn 为假：这不是某一轮失败了。同一句话不重复记 —— 一次连接失败会随
   * 渲染反复交进来。
   */
  note = (key: string, message: string): void => {
    const current = this.#now(key)
    const tail = current.timeline.items.at(-1)

    if (tail?.type === 'error' && tail.message === message) {
      return
    }

    this.#put(key, {
      ...current,
      timeline: appendLocalError(current.timeline, { message, at: Date.now(), endsTurn: false }),
    })
  }

  /* ================= 内部 ================= */

  #resolveKey(key: string): string {
    return this.#alias.get(key) ?? key
  }

  /*
   * 写路径要的那一份：先把攒着的帧折进去，再拿。
   *
   * 与 read 分开，是因为它们问的不是同一件事。read 问「订阅者此刻看到的是
   * 什么」，答案必须是已提交的状态；这里问「我要往上面追加，基线是什么」，
   * 答案必须把在途的帧算进去。同一个函数同时回答两者，就是让快照读取带上
   * 副作用。
   */
  #now(key: string): Transcript {
    return this.#settle(this.#resolveKey(key))
  }

  #fire(key: string): void {
    /* 没人听就是没人听：?? [] 会为每一帧白建一个空数组，而 #put 一帧调一次。 */
    const set = this.#listeners.get(key)

    if (set === undefined) {
      return
    }

    for (const listener of set) {
      listener()
    }
  }

  /*
   * 变了就记下，一拍发一次。
   *
   * 写入是同步的，叫醒不是。此前这两件事焊在一起，于是「agent 多说了一个字」
   * 与「该重画一屏了」成了同一件事 —— 一次回答两千次投影加布局，换六十张画面。
   */
  #notify(real: string): void {
    this.#dirty.add(real)

    if (this.#waiting) {
      return
    }

    this.#waiting = true
    this.#paint(this.#flush)
  }

  /*
   * 这一拍攒下的变化，一次交出去。
   *
   * 通知走反向索引：此前是 for (const [from, to] of alias) 找 to === key ——
   * 把正向表当反向表用，于是流式输出的每一帧都线性扫一遍。
   */
  #flush = (): void => {
    this.#waiting = false

    const dirty = this.#dirty

    this.#dirty = new Set<string>()

    for (const real of dirty) {
      this.#settle(real)
      this.#fire(real)

      const draft = this.#aliased.get(real)

      if (draft !== undefined) {
        this.#fire(draft)
      }
    }
  }

  #put(key: string, next: Transcript): void {
    /*
     * 一次解析，一次叫醒。
     *
     * 此前两行各解析一次同一个键，答案必然相同；而 #write 自己末尾还站着
     * 一行 #notify，所以一次外部写入实际叫醒两遍。那一行已经删掉（见下方
     * #write），叫醒因此从冗余变成必要 —— 这里是它的两个入口之一。
     */
    const real = this.#resolveKey(key)

    this.#write(real, next)
    this.#notify(real)
  }

  /*
   * 写下来，不惊动任何人。
   *
   * 「写」与「叫醒」此前是同一件事，于是「把攒下的帧折进去」这个动作本身也会
   * 再约一拍，而那一拍没有任何新东西可看。分开之后，叫醒由两个入口负责 ——
   * 收到帧的那一刻（#queue）与外部写入的那一刻（#put）—— 折叠只管把状态改对。
   *
   * 这一刀曾经只落在注释里：函数体末尾一直站着一行 #notify(real)。接回调用链
   * 就是一条闭合回路 —— #flush 第一行把 #waiting 放回 false，随后 #settle 折叠
   * 一次就 #write 一次、#notify 一次，于是必然再排得出一帧 rAF；那一帧里没有任何
   * 待折的帧，#fire 却照样把所有监听器叫一遍。流式期间它与帧率同频空转，一轮结束
   * 还要多跑一拍才静默。现在它真的只写。
   *
   * 更要紧的是 read() 就是 useAssistantSession 交给 useSyncExternalStore 的
   * getSnapshot。快照读取会走到这里，于是它会从 React 渲染期排出调度工作 ——
   * 而那个契约要求 getSnapshot 是纯读取。这不是快不快的问题。
   */
  #write(real: string, next: Transcript): void {
    const was = running(this.#held.get(real)?.timeline.status ?? 'idle')

    this.#held.set(real, next)

    /*
     * 从忙变闲只有这一刻。
     *
     * 挂在这里而不是挂在某一种帧上：run_finished、run_failed、取消、以及本地事故
     * （noteOn 的 endsTurn）走的是四条不同的路，但它们改的都是同一格 status，而
     * #put 是这个文件唯一的写入口。四条路一个汇合点，不需要状态机。
     */
    if (was && !running(next.timeline.status)) {
      for (const listener of this.#idle) {
        listener(real)
      }
    }
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
    const current = this.#now(key)

    this.#put(key, { ...current, timeline: noteOn(current.timeline, cause, true) })
  }

  /*
   * 攒一帧，并说一声「这条对话变了」。
   *
   * 说的是「变了」，不是「现在长这样」：状态要到有人看的那一刻才折出来。
   */
  #queue(owner: string, event: RunEvent): void {
    const real = this.#resolveKey(owner)
    const waiting = this.#pending.get(real)

    if (waiting === undefined) {
      this.#pending.set(real, [event])
    } else {
      waiting.push(event)
    }

    this.#notify(real)
  }

  /*
   * 攒下的这一批，一趟折进去。
   *
   * 一批一份草稿、一次复制、一次封版（见 applyRunEvents）。全是重复帧时它原样
   * 交回旧对象，那就什么都没发生过：引用不变，下游的记忆化不被打掉。
   */
  #settle(real: string): Transcript {
    const waiting = this.#pending.get(real)
    const current = this.#held.get(real) ?? EMPTY

    if (waiting === undefined) {
      return current
    }

    this.#pending.delete(real)

    const timeline = applyRunEvents(current.timeline, waiting)

    if (timeline === current.timeline) {
      return current
    }

    this.#write(real, { ...current, timeline })

    return this.#held.get(real) ?? EMPTY
  }

  /*
   * 一帧到了，交给它的主人。
   *
   * 查不到主人只有一种由来：这条会话不是这一侧登记过的。那就该丢掉。此前这里
   * 会把它攒起来等一个后发的地址 —— 地址现在先于帧到达，那段等待连同它的队列、
   * 计数与上限一起没有了。
   */
  #route(event: RunEvent, sessionId: string): void {
    const owner = this.#routes.get(sessionId)

    if (owner === undefined) {
      return
    }

    this.#queue(owner, event)
  }

  /* 一个 store 订着一条线路。此前这道守卫是进程级的。 */
  #attach(port: AgentSessionPort): void {
    if (this.#attachedTo === port) {
      return
    }

    this.#detach?.()
    this.#attachedTo = port
    this.#detach = port.subscribe((event, sessionId) => {
      this.#route(event, sessionId)
    })
  }
}

/** 帧流全进程只有一条，所以路由它的 store 也只有一个。 */
export const transcripts = new TranscriptStore()
