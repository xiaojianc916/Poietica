import type {
  SessionConfigControl,
  SessionConfigPort,
  SessionConfigReport,
  ThreadPort,
  ThreadRecord,
} from '@poietica/agent-protocol'
import { learnAgentControls, preferredAgentControl } from './agent-capability-store'

/** Shown for a conversation nothing has named yet: the words of the entry. */
const FALLBACK_TITLE = '新建对话'

/** How much of a stand in title a tab can carry. */
const TITLE_LIMIT = 24

const FAILURE_FALLBACK = '读取会话记录失败。'

/** 说的是选择器那一路，和上面那句不是同一件事。 */
const SELECTOR_FAILURE_FALLBACK = '这条对话没能连上 agent。'

/** Cuts a stand in title down to something a tab can show. */
export const shorten = (text: string): string => {
  const tidy = text.trim().replace(/\s+/g, ' ')

  if (tidy.length === 0) {
    return FALLBACK_TITLE
  }

  if (tidy.length <= TITLE_LIMIT) {
    return tidy
  }

  return `${tidy.slice(0, TITLE_LIMIT)}…`
}

/**
 * 一行会话在列表里的样子。
 *
 * 名字在这里就已经定下来了：三个来源（用户手改、第一句话、以及还没有名字时
 * 的入口占位）在 store 里分出胜负，渲染层拿到的是结论。此前每画一行都回头问
 * 一次 titleOf，
 * 于是名字的规则散在渲染期，而列表每帧都是一批新对象。
 */
export interface ThreadListItem {
  readonly id: string
  readonly title: string
  readonly isPinned: boolean
  readonly updatedAt: string
}

/** 侧栏要的那一片：只有这三样变了，侧栏才需要重画。 */
export interface ThreadsList {
  readonly items: readonly ThreadListItem[]
  readonly isLoading: boolean
  readonly failure: string | null
}

interface Held {
  readonly threads: readonly ThreadRecord[]
  readonly pending: readonly ThreadRecord[]
  readonly provisional: ReadonlyMap<string, string>
  readonly selectors: ReadonlyMap<string, readonly SessionConfigControl[]>
  readonly selectorFailure: ReadonlyMap<string, string>
  readonly isLoading: boolean
  readonly failure: string | null
}

const NO_ITEMS: readonly ThreadListItem[] = []

const EMPTY: Held = {
  threads: [],
  pending: [],
  provisional: new Map(),
  selectors: new Map(),
  selectorFailure: new Map(),
  isLoading: true,
  failure: null,
}

/**
 * 会话与它们的名字，整个应用一份。
 *
 * 形制与 workspaceLayoutStore 一致：状态是一个不可变快照，改动经由 #commit
 * 落定，没有真的变化就不通知。这不是风格选择——此前状态摊在七个 useState 上，
 * 由一个每次渲染都新建的对象经 Context 广播出去，于是「某条对话认领到了选择
 * 器」这种局部事实，会让每一个读过这份状态的组件连同它下面整棵树重画一遍。
 *
 * 动作是箭头字段，引用终生不变；因此它们可以直接当 prop 传下去，行组件的
 * 浅比较才第一次真的有东西可比。
 *
 * 名字排名只有一条：用户手打的胜过一切派生的。从第一句话取的替身只活在内存
 * 里，不会被误当成真名；两者都没有时用入口的名字。
 *
 * 曾经排在最上面的是 agent 自己给会话起的标题。平台已经不再上报它，因为那个
 * 标题写一次就再不修改 —— 把它排在用户实际说过的话之上，正是这张列表一度变成
 * 一列「New Session」的原因。
 */
export class ThreadsStore {
  readonly #port: ThreadPort | undefined

  readonly #config: SessionConfigPort | undefined

  #held: Held = EMPTY

  #listeners = new Set<() => void>()

  /* 一次索引，而不是每一行各扫一遍整张表。 */
  #byId = new Map<string, ThreadRecord>()

  /* 值没变的行复用同一个对象，行组件因此可以被跳过。 */
  #items = new Map<string, ThreadListItem>()

  #list: ThreadsList = { items: NO_ITEMS, isLoading: true, failure: null }

  /* 问过的对话不再问第二遍：重读是显式动作，不是渲染的副作用。 */
  #asked = new Set<string>()

  /* 会话号 → 对话。推送只带前者，而这一侧的一切都按后者记。 */
  #sessions = new Map<string, string>()

  /* 推送那一路的退订句柄；端口没有这一路时就是 undefined。 */
  #stop: (() => void) | undefined

  constructor(port?: ThreadPort, config?: SessionConfigPort) {
    this.#port = port
    this.#config = config

    /* 听 agent 自己说话。它什么时候说不由这一侧决定，所以只能一直听着。 */
    this.#stop = config?.subscribe?.((report) => {
      this.#reported(report)
    })
  }

  /** 不再听。窗口关掉时调用；不调用也只是多留一个监听器。 */
  dispose = (): void => {
    this.#stop?.()
    this.#stop = undefined
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  getSnapshot = (): Held => this.#held

  /** 侧栏读的那一片。引用只在这一片真的变了时才更换。 */
  listSnapshot = (): ThreadsList => this.#list

  /** 这条对话现在叫什么。 */
  titleOf = (threadId: string): string => {
    const found = this.#byId.get(threadId)

    /* 用户自己起的名字压过一切派生的名字。 */
    if (found?.titleSource === 'manual') {
      return found.title
    }

    const standIn = this.#held.provisional.get(threadId)

    if (standIn !== undefined) {
      return standIn
    }

    if (found === undefined) {
      return FALLBACK_TITLE
    }

    return found.titleSource === 'fallback' ? FALLBACK_TITLE : shorten(found.title)
  }

  /** The stand in name a message would give a conversation. */
  standInTitle = (message: string): string => shorten(message)

  /** 这条对话所持有的会话给出的选择器；从没拿到过就是 undefined。 */
  selectorsOf = (threadId: string): readonly SessionConfigControl[] | undefined =>
    this.#held.selectors.get(threadId)

  /** 上一次认领或改动失败时的说法，按对话记。 */
  selectorFailureOf = (threadId: string): string | undefined =>
    this.#held.selectorFailure.get(threadId)

  refresh = async (): Promise<void> => {
    const port = this.#port

    if (port === undefined) {
      this.#commit({ isLoading: false })

      return
    }

    try {
      const found = await port.list()

      this.#commit({ threads: found, failure: null, isLoading: false })
    } catch (reason) {
      this.#commit({ failure: this.#reasonOf(reason), isLoading: false })
    }
  }

  create = async (): Promise<string | null> => {
    const port = this.#port

    if (port === undefined) {
      return null
    }

    try {
      const opened = await port.open()
      const threadId = opened.thread.threadId

      this.#hold(opened.thread)

      /*
       * 会话是跟着这条对话一起开出来的，选择器就在同一个答复里。这是唯一
       * 不需要再问一次的时刻。
       *
       * 一条对话在有人开口之前不进列表，所以这里不添行：那会留下一串从未
       * 发生过的对话。
       */
      this.#asked.add(threadId)
      this.#commit({
        selectors: this.#with(this.#held.selectors, threadId, opened.selectors),
        failure: null,
      })

      /*
       * 入口那一格选的值在这里落地。
       *
       * 它是在没有会话的时候选的（选择器画的是偏好），所以会话一开出来就得把
       * 差异补上，否则那个选择器只是装饰。只补真的不一致的项。
       */
      for (const control of opened.selectors) {
        const wanted = preferredAgentControl(control.id)

        if (wanted !== undefined && wanted !== control.current) {
          this.selectControl(threadId, control.id, wanted)
        }
      }

      return threadId
    } catch (reason) {
      this.#commit({ failure: this.#reasonOf(reason) })

      return null
    }
  }

  /*
   * 平台在第一轮开始时才记下一条对话，所以发出的那一刻读回来可能还没有它。
   * 先把行显示出来、让下一次读取认领走，是列表类界面的常规乐观更新。
   */
  nameFromMessage = (threadId: string, message: string): void => {
    const found = this.#byId.get(threadId)
    const standIn = shorten(message)
    const provisional = this.#with(this.#held.provisional, threadId, standIn)

    if (found !== undefined) {
      this.#commit({ provisional })

      return
    }

    const pending = this.#held.pending.some((thread) => thread.threadId === threadId)
      ? this.#held.pending
      : [
          ...this.#held.pending,
          {
            threadId,
            sessionId: null,
            title: standIn,
            titleSource: 'message' as const,
            updatedAt: new Date().toISOString(),
          },
        ]

    this.#commit({ pending, provisional })
  }

  /*
   * 三个动作：先改本地，再落库。
   *
   * 立刻可见是列表类界面的通行做法，而真相仍然只有一个来源；端口没有实现
   * 某个动作时什么都不做，界面不会假装做过。
   */
  rename = async (threadId: string, title: string): Promise<void> => {
    const act = this.#port?.rename
    const named = title.trim()

    if (act === undefined || named.length === 0) {
      return
    }

    this.#commit({
      threads: this.#held.threads.map((thread) =>
        thread.threadId === threadId
          ? { ...thread, title: named, titleSource: 'manual' as const }
          : thread,
      ),
      provisional: this.#without(this.#held.provisional, threadId),
    })

    await this.#settle(act(threadId, named))
  }

  remove = async (threadId: string): Promise<void> => {
    const act = this.#port?.remove

    if (act === undefined) {
      return
    }

    this.#commit({
      threads: this.#held.threads.filter((thread) => thread.threadId !== threadId),
      pending: this.#held.pending.filter((thread) => thread.threadId !== threadId),
    })

    await this.#settle(act(threadId))
  }

  setPinned = async (threadId: string, pinned: boolean): Promise<void> => {
    const act = this.#port?.setPinned

    if (act === undefined) {
      return
    }

    this.#commit({
      threads: this.#held.threads.map((thread) =>
        thread.threadId === threadId ? { ...thread, pinned } : thread,
      ),
    })

    await this.#settle(act(threadId, pinned))
  }

  /*
   * 认领一条不是本次运行开出来的对话：让它握住一个会话。
   *
   * 原生侧在同一个答复里给出这条对话现在持有的会话，和 agent 为它报的整张
   * 选择器表，与新开一条对话走的是同一条路——所以选择器只有一个到达口，
   * 也就没有「空表」和「读失败」这两种半状态。
   */
  adopt = (threadId: string): void => {
    if (this.#asked.has(threadId)) {
      return
    }

    this.#read(threadId)
  }

  retrySelectors = (threadId: string): void => {
    this.#commit({ selectorFailure: this.#without(this.#held.selectorFailure, threadId) })
    this.#read(threadId)
  }

  /** 改这条对话的一项会话设置；答案就是改完之后的整张表。 */
  selectControl = (threadId: string, controlId: string, value: string): void => {
    const config = this.#config

    if (config === undefined) {
      return
    }

    config
      .select(threadId, controlId, value)
      .then((offered) => {
        this.#remember(threadId, offered)
      })
      .catch(() => {
        /*
         * 改动没落地。
         *
         * 不把技术原因常驻到会话设置那一格上：那一格说的是「这条对话连没连上
         * agent」，一次改动失败不是那件事，而且失败按对话记一格，谁失败都会写在
         * 模型选择器上。这里向 agent 重问一次权威表 —— UI 因此回到真正生效的值，
         * 是权威回滚，不是本地猜一个旧值填回去。连重问都失败时，下面那个 catch
         * 才会说「没连上」，那时这句话才是准确的。
         */
        this.#read(threadId)
      })
  }

  #read(threadId: string): void {
    const port = this.#port

    if (port === undefined) {
      return
    }

    this.#asked.add(threadId)
    port
      .open(threadId)
      .then((opened) => {
        this.#hold(opened.thread)
        this.#remember(threadId, opened.selectors)
      })
      .catch((reason: unknown) => {
        this.#noteSelectorFailure(threadId, reason)
      })
  }

  /*
   * 记下这条对话现在握着哪个会话。
   *
   * 会话是在 port.open() 里诞生（或被装载回来）的，所以那两处就是这张反查表
   * 唯一建立得起来的时刻。列表读回来的那些号不算：它们可能是上一次运行留下的，
   * 而推送只会来自活着的会话。
   */
  #hold(thread: ThreadRecord): void {
    const sessionId = thread.sessionId

    if (sessionId === null) {
      return
    }

    this.#sessions.set(sessionId, thread.threadId)
  }

  /*
   * agent 自己报来了一张新表。
   *
   * 到达口仍然是 #remember —— 与 open 和 select 同一个。所以这不是第三条取数
   * 路径，只是第三个说话的人；能力表照样学，失败那一格照样清。
   *
   * 认不得的会话号直接丢掉，那是别的连接或者已经不在的对话。
   */
  #reported(report: SessionConfigReport): void {
    const threadId = this.#sessions.get(report.sessionId)

    if (threadId === undefined) {
      return
    }

    this.#remember(threadId, report.controls)
  }

  #remember(threadId: string, offered: readonly SessionConfigControl[]): void {
    /* 这张表属于这个 agent，不属于这一条对话；入口那一格靠它才有东西可画。 */
    learnAgentControls(offered)

    this.#commit({
      selectors: this.#with(this.#held.selectors, threadId, offered),
      selectorFailure: this.#without(this.#held.selectorFailure, threadId),
    })
  }

  #noteSelectorFailure(threadId: string, reason: unknown): void {
    this.#commit({
      selectorFailure: this.#with(
        this.#held.selectorFailure,
        threadId,
        reason instanceof Error ? reason.message : SELECTOR_FAILURE_FALLBACK,
      ),
    })
  }

  async #settle(work: Promise<unknown>): Promise<void> {
    try {
      await work
      this.#commit({ failure: null })
    } catch (reason) {
      this.#commit({ failure: this.#reasonOf(reason) })
    }
  }

  #reasonOf(reason: unknown): string {
    return reason instanceof Error ? reason.message : FAILURE_FALLBACK
  }

  #with<T>(map: ReadonlyMap<string, T>, key: string, value: T): ReadonlyMap<string, T> {
    if (map.get(key) === value) {
      return map
    }

    const next = new Map(map)

    next.set(key, value)

    return next
  }

  #without<T>(map: ReadonlyMap<string, T>, key: string): ReadonlyMap<string, T> {
    if (!map.has(key)) {
      return map
    }

    const next = new Map(map)

    next.delete(key)

    return next
  }

  #commit(patch: Partial<Held>): void {
    const next: Held = { ...this.#held, ...patch }

    /*
     * 变化检查按 patch 的键走。
     *
     * 此前这里手抄了 Held 的七个字段。手抄的那份在加第八个字段时会静默漏掉,
     * 而漏掉的表现是"改了却不通知" —— 一个只在特定字段上发作的 bug。没被 patch
     * 的字段不可能变,所以按键比较既短,也不可能忘。
     */
    if ((Object.keys(patch) as (keyof Held)[]).every((key) => next[key] === this.#held[key])) {
      return
    }

    /*
     * 列表的输入只有这三样。
     *
     * 一行的样子只由 threads / pending / provisional 决定(见 #itemFor):
     * selectors 与 selectorFailure 对它零影响,而它们是提交最频繁的两个 ——
     * adopt 一条对话就是一次提交。此前每一次提交都重跑 #project:重建 #byId、
     * 重算每一行的标题、重建 #items。打开 40 条对话就是 40 趟 O(N) 的无用功。
     *
     * 派生视图只在它的输入变化时重算,这是 store 派生状态的基本形态。
     */
    const listing =
      next.threads !== this.#held.threads ||
      next.pending !== this.#held.pending ||
      next.provisional !== this.#held.provisional

    this.#held = next

    if (listing) {
      this.#project()
    } else if (next.isLoading !== this.#list.isLoading || next.failure !== this.#list.failure) {
      /* 只有这两格变了:行一个都没变,连数组引用都不该换。 */
      this.#list = { items: this.#list.items, isLoading: next.isLoading, failure: next.failure }
    }

    for (const listener of this.#listeners) {
      listener()
    }
  }

  /*
   * 把快照投影成列表要用的形状，一次。
   *
   * 逐行复用值没变的对象，整张列表没变时连数组本身都不换——于是「某条对话
   * 拿到了选择器」不会让侧栏的任何一行重画。
   */
  #project(): void {
    const listed = this.#listed()
    const byId = new Map<string, ThreadRecord>()

    for (const thread of listed) {
      byId.set(thread.threadId, thread)
    }

    this.#byId = byId

    const kept = new Map<string, ThreadListItem>()
    const items: ThreadListItem[] = []
    let same = listed.length === this.#list.items.length

    for (const [index, thread] of listed.entries()) {
      const item = this.#itemFor(thread)

      kept.set(thread.threadId, item)
      items.push(item)

      if (same && this.#list.items[index] !== item) {
        same = false
      }
    }

    this.#items = kept

    const { failure, isLoading } = this.#held

    if (same && this.#list.isLoading === isLoading && this.#list.failure === failure) {
      return
    }

    this.#list = { items: same ? this.#list.items : items, isLoading, failure }
  }

  #itemFor(thread: ThreadRecord): ThreadListItem {
    const title = this.titleOf(thread.threadId)
    const isPinned = thread.pinned === true
    const last = this.#items.get(thread.threadId)

    if (
      last !== undefined &&
      last.title === title &&
      last.isPinned === isPinned &&
      last.updatedAt === thread.updatedAt
    ) {
      return last
    }

    return { id: thread.threadId, title, isPinned, updatedAt: thread.updatedAt }
  }

  /* 刚开口的对话排在最前，直到下一次读取把它认领走。 */
  #listed(): readonly ThreadRecord[] {
    const { pending, threads } = this.#held

    if (pending.length === 0) {
      return threads
    }

    const known = new Set(threads.map((thread) => thread.threadId))
    const extra = pending.filter((thread) => !known.has(thread.threadId))

    return extra.length === 0 ? threads : [...extra, ...threads]
  }
}
