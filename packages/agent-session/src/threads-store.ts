import type {
  SessionConfigControl,
  SessionConfigPort,
  SessionConfigReport,
  ThreadAttachment,
  ThreadHistory,
  ThreadPort,
  ThreadRecord,
} from '@poietica/acp'
import { agentChosen, observeAgentControls } from './agent-capability-store'
import { describeFailure } from './describe-failure'
import { byRecency, type ThreadListItem, type ThreadsList } from './thread-order'
import { nameOf, shorten } from './thread-title'

/**
 * 转录那一侧，只要这四句话。
 *
 * 打开一条对话现在会把它的经过一起带回来，而经过归转录 store 管。注入而不是
 * import 那个单例：这个文件自己在下面说过，模块级可变量让测试拿不到干净实例。
 * 声明成一个只有三个方法的接口，是为了让测试能塞一个假的进来。
 */
export interface TranscriptSink {
  readonly opening: (threadId: string) => void
  readonly adopt: (
    threadId: string,
    events: readonly unknown[],
    history: ThreadHistory,
    attachments: readonly ThreadAttachment[],
    prompts: number,
  ) => void
  readonly failed: (threadId: string, cause: unknown) => void
  /** 运行帧按会话号到达，而这一侧的一切按对话记：这是两者之间唯一的那张表。 */
  readonly route: (sessionId: string, threadId: string) => void
  /** 这条对话不存在了：转录连同指向它的路由一起作废。 */
  readonly forget: (threadId: string) => void
  /**
   * 这条对话此刻有没有一轮在飞。
   *
   * 权威是转录自己的 status（RunStatus 的 running / awaiting_permission），不另记
   * 一张在飞表：同一个事实两处维护，迟早各说各的。转录已经逐帧维护着它，输入框
   * 那一侧读的也是同一格（useAssistantSession 的 toChatStatus）。
   */
  readonly busy: (threadId: string) => boolean
  /** 某条对话从忙变闲的那一刻。参数是那条对话。 */
  readonly onIdle: (listener: (threadId: string) => void) => () => void
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

  /* 想知道「某条对话没了」的人。 */
  #removed = new Set<(threadId: string) => void>()

  /* 一次索引，而不是每一行各扫一遍整张表。 */
  #byId = new Map<string, ThreadRecord>()

  /* 值没变的行复用同一个对象，行组件因此可以被跳过。 */
  #items = new Map<string, ThreadListItem>()

  #list: ThreadsList = { items: NO_ITEMS, isLoading: true, failure: null }

  /* 问过的对话不再问第二遍：重读是显式动作，不是渲染的副作用。 */
  #asked = new Set<string>()

  /* 会话号 → 对话。推送只带前者，而这一侧的一切都按后者记。 */
  #sessions = new Map<string, string>()

  /*
   * 这条会话内部真的握着哪些值 —— agent 最近一次报的原话，按 controlId 记。
   *
   * 它不是显示值。显示的那一份被投影成了全局选中的那个（见 #shown），拿它去判断
   * "要不要真的切一次"永远会得出"已经切好了"。两个值必须分开存。
   */
  #actual = new Map<string, ReadonlyMap<string, string>>()

  /*
   * 已经为这条会话的某一项试过切到哪个值。
   *
   * 切换失败会走 catch 里的重读，重读又会得出同一个结论 —— 没有这道闸，一次 agent
   * 拒绝就是一个不停打命令的循环。换一个目标值时重新允许。
   */
  #tried = new Map<string, ReadonlyMap<string, string>>()

  readonly #transcripts: TranscriptSink | undefined

  constructor(port?: ThreadPort, config?: SessionConfigPort, transcripts?: TranscriptSink) {
    this.#port = port
    this.#config = config
    this.#transcripts = transcripts
  }

  /**
   * 开始听 agent 自己说话，并交回停下来的办法。
   *
   * 订阅此前发生在构造函数里，退订是另一个方法（dispose），而那个方法全仓
   * 一个调用点都没有。这两件事一旦分家就修不好：谁来调 dispose？唯一合理的
   * 地方是 Provider 的 effect 清理，可 store 是 useMemo 造的 —— React 在开发
   * 模式下会装载、卸载、再装载一次，那一趟会把订阅退掉，而构造函数不会跑第
   * 二遍。于是「不调」只是漏一个监听器，「调了」反而让推送在开发模式下永久
   * 失聪，且没有任何报错。
   *
   * 订阅与退订成对地交给 effect，是 React 对这件事自己的答案：装载几次就订
   * 阅几次、退订几次，不可能配不平。
   */
  start = (): (() => void) => {
    const stop = this.#config?.subscribe?.((report) => {
      this.#reported(report)
    })

    /*
     * 人在别处拨动了模型选择器。
     *
     * 缓存下来的那些会话表是历史快照：它们记着自己到达那一刻的值，此后全局选中什么
     * 变了多少次都与它们无关。此前「打开一条开过的旧对话又变回旧模型」就是这么来的
     * —— adopt 在 #asked 那一行直接返回，没有任何人回头去更新那份缓存。
     *
     * 投影必须是持续成立的，不能是到达时对齐一次。
     */
    const release = observeAgentControls(() => {
      this.#realign()
    })

    /*
     * 一条对话空下来了：那是它欠着的那次切换唯一该补发的时刻。
     *
     * 不需要队列，也不需要新状态。#align 自己比对 #actual 与全局值，
     * 忙的时候直接跳过，空下来再问一次即可 —— 已经对上了就什么都不做。
     */
    const settled = this.#transcripts?.onIdle((threadId) => {
      this.#align(threadId)
    })

    return () => {
      stop?.()
      release()
      settled?.()
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * 某条对话被删除的那一刻；交回取消订阅的办法。
   *
   * 「这条对话存不存在」的权威只有这一份，所以说得出这句话的也只有这里。
   * 谁需要跟着收拾（工作台上开着它的那一格，以后可能出现的别的观众）由他们
   * 自己来听 —— 而不是让每一个删除入口各自记得再删一遍标签，那是两条写路径。
   */
  onRemoved = (listener: (threadId: string) => void): (() => void) => {
    this.#removed.add(listener)

    return () => {
      this.#removed.delete(listener)
    }
  }

  getSnapshot = (): Held => this.#held

  /** 侧栏读的那一片。引用只在这一片真的变了时才更换。 */
  listSnapshot = (): ThreadsList => this.#list

  /** 这条对话现在叫什么。 */
  titleOf = (threadId: string): string =>
    nameOf(this.#byId.get(threadId), this.#held.provisional.get(threadId))

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
      this.#commit({ failure: describeFailure(reason), isLoading: false })
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

      /* 刚建的一条没有经过。说出来，好过让它停在"还在取"上。 */
      this.#transcripts?.adopt(
        threadId,
        opened.events,
        opened.history,
        opened.attachments,
        opened.prompts,
      )

      /*
       * 会话是跟着这条对话一起开出来的，选择器就在同一个答复里。这是唯一
       * 不需要再问一次的时刻。
       *
       * 一条对话在有人开口之前不进列表，所以这里不添行：那会留下一串从未
       * 发生过的对话。
       */
      this.#asked.add(threadId)
      this.#remember(threadId, opened.selectors)
      this.#commit({ failure: null })

      return threadId
    } catch (reason) {
      this.#commit({ failure: describeFailure(reason) })

      return null
    }
  }

  /**
   * 人在这条对话里说了一句话。
   *
   * 两个事实，与库那侧的 record_prompt 一一对应：这条对话刚刚有活动，以及
   * —— 只有它还没有名字时 —— 它从此叫这句话。这里写的是乐观值，库那份权威
   * 会在下一次整表读取时盖上来；两边的规则必须逐字相同，否则那一盖就是一次
   * 肉眼可见的跳变。
   *
   * 平台在第一轮开始时才记下一条对话，所以发出的那一刻读回来可能还没有它。
   * 先把行显示出来、让下一次读取认领走，是列表类界面的常规乐观更新。
   */
  noteUserMessage = (threadId: string, message: string): void => {
    const found = this.#byId.get(threadId)
    const at = new Date().toISOString()

    /*
     * 占位只在这条对话还没有名字的时候写。
     *
     * 有名字了就不该再有占位：那个名字是第一句话，而这一句不是第一句。此前
     * 这里无条件覆盖，于是标题一路跟着最后一句话走。
     */
    const provisional =
      found === undefined || found.titleSource === 'fallback'
        ? this.#with(this.#held.provisional, threadId, shorten(message))
        : this.#held.provisional

    if (found !== undefined) {
      /*
       * 说话就是活动，而列表按活动排（见 #listed）。这一格必须当场跟上：
       * 等库那份回来要到下一次整表读取，那时人早就看着一条没浮上来的对话了。
       */
      this.#commit({
        provisional,
        threads: this.#held.threads.map((thread) =>
          thread.threadId === threadId ? { ...thread, updatedAt: at } : thread,
        ),
      })

      return
    }

    const pending = this.#held.pending.some((thread) => thread.threadId === threadId)
      ? this.#held.pending
      : [
          ...this.#held.pending,
          {
            threadId,
            sessionId: null,
            title: shorten(message),
            titleSource: 'message' as const,
            updatedAt: at,
          },
        ]

    this.#commit({ pending, provisional })
  }

  /*
   * 改名与置顶：先改本地，再落库。落库失败由 #settle 向权威重问一次回滚。
   *
   * 立刻可见是列表类界面的通行做法，而真相仍然只有一个来源；端口没有实现
   * 某个动作时什么都不做，界面不会假装做过。
   *
   * 删除不在这一类里，理由见 remove 自己那一段。
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

    /*
     * 删除先落库，再在本地生效。这一条与改名、置顶反过来，是有理由的。
     *
     * 那两个是可逆的属性变更：乐观更新失败了，向权威重问一次就回到原样。删除
     * 不是。它同时作废这条对话的转录（forget）、并向 #removed 广播让工作台关掉
     * 开着它的那一格 —— 两件事都不是一次 refresh 能复原的，于是「先删本地再落
     * 库」在失败时留下的是一份谁都没认可的状态：屏幕上没有了，盘上还在。
     *
     * 破坏性动作等一次本地往返（落的是本机 SQLite，不是网络），换的是「屏幕上
     * 没有的东西盘上也没有」。
     */
    try {
      await act(threadId)
    } catch (reason) {
      this.#commit({ failure: describeFailure(reason) })

      return
    }

    /* 按对话记的那几格跟着走。此前它们只增不减，删一条对话会在五处各留一格。 */
    this.#asked.delete(threadId)
    this.#actual.delete(threadId)
    this.#tried.delete(threadId)

    /* 会话号那张反查表同样按对话记。#hold 只写不删，删除是它唯一的出口。 */
    for (const [sessionId, owner] of this.#sessions) {
      if (owner === threadId) {
        this.#sessions.delete(sessionId)
      }
    }

    this.#commit({
      threads: this.#held.threads.filter((thread) => thread.threadId !== threadId),
      pending: this.#held.pending.filter((thread) => thread.threadId !== threadId),
      selectors: this.#without(this.#held.selectors, threadId),
      selectorFailure: this.#without(this.#held.selectorFailure, threadId),
      failure: null,
    })

    /* 经过随对话一起作废：删掉的东西不该还能被读回来。 */
    this.#transcripts?.forget(threadId)

    for (const listener of this.#removed) {
      listener(threadId)
    }
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
      /*
       * 会话早就开着了，不必再问一趟。但它内部握的模型可能还是上一次的 —— 手伸过来
       * 就是把它掰回当前选中那个的时刻。是幂等的：已经对上了就什么都不做。
       */
      this.#align(threadId)

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

    /* 这一趟要回来的不只是选择器，还有这条对话的经过。 */
    this.#transcripts?.opening(threadId)

    port
      .open(threadId)
      .then((opened) => {
        this.#hold(opened.thread)
        this.#remember(threadId, opened.selectors)
        this.#transcripts?.adopt(
          threadId,
          opened.events,
          opened.history,
          opened.attachments,
          opened.prompts,
        )
      })
      .catch((reason: unknown) => {
        this.#noteSelectorFailure(threadId, reason)

        /* 同一次失败的两个后果：设置那一格画不出来，对话也打不开。 */
        this.#transcripts?.failed(threadId, reason)
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

    /*
     * 同一个事实，转录那一侧也要一份。
     *
     * 这里是打开一条对话的两条路（create 与 #read）唯一的汇合处，也是这张表
     * 唯一建得起来的时刻：会话号到手在前，第一帧到达在后。
     */
    this.#transcripts?.route(sessionId, thread.threadId)
  }

  /*
   * agent 自己报来了一张新表。
   *
   * 到达口仍然是 #remember —— 与 open 和 select 同一个。所以这不是第三条取数
   * 路径，只是第三个说话的人；失败那一格照样清。
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

  /*
   * 一张表到了。这是三条路（open / select / agent 主动上报）唯一的汇合处。
   *
   * 两件事在这里分开：agent 报的原话进 #actual（这条会话真在用什么），存进
   * selectors 的那一份则是投影（屏幕上该显示什么）。此前只存了一份，于是"显示"与
   * "真值"共用一格，谁也说不清那格里的东西是哪一个。
   */
  #remember(threadId: string, offered: readonly SessionConfigControl[]): void {
    this.#actual.set(threadId, new Map(offered.map((control) => [control.id, control.current])))

    this.#commit({
      selectors: this.#with(this.#held.selectors, threadId, this.#shown(offered)),
      selectorFailure: this.#without(this.#held.selectorFailure, threadId),
    })

    this.#align(threadId)
  }

  /*
   * 全局选中的那个模型变了：所有缓存下来的表都要重新投影一次。
   *
   * 这是"投影"与"到达时对齐一次"的分水岭。少了这一步，一条开过的旧对话会永远停在
   * 它第一次打开时的那个模型上 —— 而那正是这一刀要修的东西。
   *
   * 顺带把每条会话真的切过去：屏幕上写着甲、内部握着乙，是比显示错更坏的一种错。
   * #align 自带闸门，重复调用不会重复发命令。
   */
  #realign(): void {
    /*
     * 表在这里捕获一次，两个循环都读它。
     *
     * 下面那趟对齐此前写的是 this.#held.selectors.keys()，而它跑在 #commit 之后
     * —— #held 已经整个换过，读到的是新表。今天两张表的键相同，所以看不出毛病；
     * 但那是「#shown 不增删键」这个从没写下来的前提在替它兜底。捕获之后，键从哪
     * 来是写死的，不是推断的。
     */
    const held = this.#held.selectors

    /*
     * 不走 #with：那是改一格的工具，每改一格复制整张表。这里要改的是每一格，
     * 逐格调用就是 N 张全量拷贝，其中 N-1 张当场变成垃圾。真有变化时复制一次，
     * 一格都没变就连提交都不发。
     */
    let next: Map<string, readonly SessionConfigControl[]> | undefined

    for (const [threadId, table] of held) {
      const shown = this.#shown(table)

      if (shown === table) {
        continue
      }

      next ??= new Map(held)
      next.set(threadId, shown)
    }

    if (next !== undefined) {
      this.#commit({ selectors: next })
    }

    for (const threadId of held.keys()) {
      this.#align(threadId)
    }
  }

  /*
   * 这条对话的表画出来该是什么样：每一项都等于全局选中的那个值。
   *
   * 没有全局值时保持这条会话自己报的值 —— 那是启动后还没问到的那一小段，总得有
   * 东西可画。那个值不在这条会话的候选里也不动：显示一个它给不出的值，只会让下
   * 一次切换失败。
   *
   * 投影必须是持续成立的，不是到达时对齐一次；没有可换的就原样交回同一个引用，
   * #with 因此认得出"没变"，一次多余的提交都不会发生。
   */
  #shown(table: readonly SessionConfigControl[]): readonly SessionConfigControl[] {
    let changed = false

    const next = table.map((control) => {
      const wanted = agentChosen(control.id)

      if (wanted === undefined || control.current === wanted) {
        return control
      }

      if (!control.choices.some((choice) => choice.value === wanted)) {
        return control
      }

      changed = true

      return { ...control, current: wanted }
    })

    return changed ? next : table
  }

  /*
   * 把这条会话真的切到全局选中的那些值上。
   *
   * 判据是 #actual（agent 报的原话），不是屏幕上那份 —— 后者已经被投影过，拿它判
   * 永远得出"已经对上了"。这就是光改显示会撒谎的地方：下一句话仍由旧值来答。
   *
   * 一个目标值只试一次。切换失败会走 selectControl 的 catch 去重读，重读得出同样
   * 的结论，没有这道闸就是一个不停打命令的循环。
   *
   * 这一轮已经发出去了，中途改人不会让它换个人重答。上游 TUI 在这里直接拒绝用户，
   * 那是单会话终端的前提；我们能同时开多条，而选中值是全局那一份，不该被某一条的
   * 忙碌绑架 —— 所以拦的不是人的动作，是这一条下发。空下来时由 start() 里订阅的
   * onIdle 补上，闸在这里不消耗 #tried。
   */
  #align(threadId: string): void {
    const table = this.#held.selectors.get(threadId)
    const actual = this.#actual.get(threadId)

    if (table === undefined || actual === undefined) {
      return
    }

    if (this.#transcripts?.busy(threadId) === true) {
      return
    }

    for (const control of table) {
      const wanted = agentChosen(control.id)

      if (wanted === undefined || wanted === actual.get(control.id)) {
        continue
      }

      const tried = this.#tried.get(threadId)

      if (tried?.get(control.id) === wanted) {
        continue
      }

      if (!control.choices.some((choice) => choice.value === wanted)) {
        continue
      }

      const next = new Map(tried)

      next.set(control.id, wanted)
      this.#tried.set(threadId, next)

      this.selectControl(threadId, control.id, wanted)
    }
  }

  #noteSelectorFailure(threadId: string, reason: unknown): void {
    this.#commit({
      selectorFailure: this.#with(this.#held.selectorFailure, threadId, describeFailure(reason)),
    })
  }

  /*
   * rename / remove / setPinned 三个动作的收尾，只有这一处。
   *
   * 它们都先改本地再落库。落库失败时本地那一改必须退回权威值，否则一次失败的
   * 删除就是"行从屏幕上没了，东西还在盘上"——而下一次 refresh 之前没人会发现。
   * 与 selectControl 的 catch 同一套办法：不本地猜一个旧值填回去，向权威重读。
   *
   * 先回滚再记原因：refresh 成功时会 commit 一次 failure: null，顺序反了就把
   * 这句话抹掉了。
   */
  /*
   * 一次乐观写入的收尾。改名与置顶走这里，删除不走。
   *
   * 失败时先向权威重问一次，与 selectControl 的 catch 同一个办法：回滚是把真相
   * 拉回来，不是在本地猜一个旧值填回去。此前这里只写一句 failure，于是改名失败
   * 之后屏幕上留着的是那个没写进去的新名字。
   *
   * 顺序不能反：refresh 成功时自己会提交 failure: null，那句话必须排在它后面。
   */
  async #settle(work: Promise<unknown>): Promise<void> {
    try {
      await work
      this.#commit({ failure: null })
    } catch (reason) {
      await this.refresh()
      this.#commit({ failure: describeFailure(reason) })
    }
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
    const title = nameOf(thread, this.#held.provisional.get(thread.threadId))
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

  /**
   * 列表的顺序，只有这一处说了算。
   *
   * 置顶在前，然后按活动时间倒序 —— 与库里那条 ORDER BY 同一条规则，因为它
   * 们排的是同一个列表。库那份是初次读回来时的顺序；而说一句话之后 updatedAt
   * 是先在本地改的（见 noteUserMessage），排序必须跟着在本地重算一次，否则
   * 「刚说过话的对话浮上来」要等到下一次整表刷新才发生。
   *
   * 这不是两个真源：规则只写了一遍，执行了两次 —— 一次在读回来的那一刻，一次
   * 在本地推进的那一刻。
   *
   * 刚开口、平台还没记下的那些自带此刻的时间戳，所以它们自然排在最前，不需要
   * 一条额外的「pending 优先」规则。
   */
  #listed(): readonly ThreadRecord[] {
    const { pending, threads } = this.#held

    const known = new Set(threads.map((thread) => thread.threadId))
    const extra = pending.filter((thread) => !known.has(thread.threadId))
    const all = extra.length === 0 ? threads : [...extra, ...threads]

    return [...all].sort(byRecency)
  }
}
