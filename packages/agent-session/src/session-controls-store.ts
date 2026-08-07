import type {
  SessionConfigControl,
  SessionConfigPort,
  SessionConfigReport,
  ThreadPort,
  ThreadRecord,
} from '@poietica/acp'
import type { AgentChoices } from './agent-capability-store'
import { describeFailure } from './describe-failure'
import { withEntry, withoutEntry } from './immutable-map'
import type { TranscriptSink } from './transcript-sink'

/** 打开一条对话拿回来的那一整份答复。形状由端口说了算，不另抄一遍。 */
type OpenedThread = Awaited<ReturnType<ThreadPort['open']>>

interface Held {
  readonly selectors: ReadonlyMap<string, readonly SessionConfigControl[]>
  readonly selectorFailure: ReadonlyMap<string, string>
}

/** 这条对话下一步该改的那一项。一次只有一个。 */
interface Pending {
  readonly controlId: string
  readonly value: string
}

const EMPTY: Held = { selectors: new Map(), selectorFailure: new Map() }

export interface SessionControlsOptions {
  /** 状态变了叫一声。 */
  readonly announce: () => void
  /** 全局选中了哪些值。缺席时这台引擎什么都不对齐。 */
  readonly choices?: AgentChoices | undefined
  readonly config?: SessionConfigPort | undefined
  readonly port?: ThreadPort | undefined
  readonly transcripts?: TranscriptSink | undefined
}

/**
 * 一条对话背后那个会话：它握着哪些值，还能选什么，以及把它掰到全局选中值上。
 *
 * 与对话列表分开，是因为它们本来就是两样东西。列表是一批记录（名字、活动时间、
 * 置顶），来自一次整表读取；这里是一台持续运行的对齐引擎 —— 全局选中值推一下，
 * #realign 扫一遍，#align 挑出下一项该改的，答复回到 #remember，再驱动一次。
 * 它自己会转，而列表不会。
 *
 * 下发是串行的，一条对话同时只在飞一条改动。ACP 规定改一项可能增删另一项
 * （见 @poietica/acp 的 config.ts，以及原生侧 commands.rs 的 select 文档），
 * 所以有依赖关系的选择器不能并发下发：模型与推理档位一起发出去，档位那一条会
 * 在 agent 那侧对着上一个模型求值，而两条答复各带一整张表，谁后回来谁覆盖。
 * 模型排在最前，它的答复到手之后其余各项才重新评估。
 *
 * 依赖全部构造时交进来：端口、配置、转录、那份全局选中值，以及通知 —— announce
 * 汇回 ThreadsStore 那一条订阅，读谁的状态与怎么被叫醒是两件事。这台引擎因此可以
 * 在没有任何进程单例的情况下被单独构造。
 */
export class SessionControlsStore {
  readonly #port: ThreadPort | undefined

  readonly #config: SessionConfigPort | undefined

  readonly #transcripts: TranscriptSink | undefined

  readonly #announce: () => void

  readonly #choices: AgentChoices | undefined

  #held: Held = EMPTY

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
   * 切换失败会走重读，重读又会得出同一个结论 —— 没有这道闸，一次 agent 拒绝就是
   * 一个不停打命令的循环。
   *
   * 记的是"这个值试过了"，而一个值能不能试取决于它还在不在候选里：换了模型之后
   * 候选整个换一套，上一次白试的那些不再作数（见 #prune）。少了剪枝这一步，先
   * 失败过一次的那一项就永久卡在闸后 —— 换到一个真的提供该档位的模型也不再下发。
   */
  #tried = new Map<string, ReadonlyMap<string, string>>()

  /*
   * 这条对话此刻在飞的那一次改动。
   *
   * 它同时是队列和闸门：#align 见到有东西在飞就不再下发，答复回来由队列出口重新
   * 驱动一次。串行不是为了省往返，是因为 agent 的答复才是下一步的判据 —— 并发
   * 下发时第二条命令用的是一张已经作废的表。
   */
  #inflight = new Map<string, Promise<void>>()

  constructor({ announce, choices, config, port, transcripts }: SessionControlsOptions) {
    this.#announce = announce
    this.#choices = choices
    this.#config = config
    this.#port = port
    this.#transcripts = transcripts
  }

  snapshot = (): Held => this.#held

  /**
   * 开始听 agent 自己说话，并交回停下来的办法。
   *
   * 订阅与退订成对地交给 effect，是 React 对这件事自己的答案：装载几次就订阅几次、
   * 退订几次，不可能配不平。放在构造函数里则配不平 —— store 由 useState 造，开发
   * 模式下的装载/卸载/再装载会把订阅退掉，而构造函数不会跑第二遍。
   */
  start = (): (() => void) => {
    const stop = this.#config?.subscribe?.((report) => {
      this.#reported(report)
    })

    /*
     * 人在别处拨动了选择器。
     *
     * 缓存下来的那些会话表是历史快照：它们记着自己到达那一刻的值，此后全局选中什么
     * 变了多少次都与它们无关。投影必须是持续成立的，不能是到达时对齐一次。
     */
    const release = this.#choices?.observe(() => {
      this.#realign()
    })

    /*
     * 一条对话空下来了：那是它欠着的那次切换唯一该补发的时刻。
     *
     * 不需要队列，也不需要新状态。#align 自己比对 #actual 与全局值，忙的时候直接
     * 跳过，空下来再问一次即可 —— 已经对上了就什么都不做。
     */
    const settled = this.#transcripts?.onIdle((threadId) => {
      this.#align(threadId)
    })

    return () => {
      stop?.()
      release?.()
      settled?.()
    }
  }

  /** 这条对话所持有的会话给出的选择器；从没拿到过就是 undefined。 */
  selectorsOf = (threadId: string): readonly SessionConfigControl[] | undefined =>
    this.#held.selectors.get(threadId)

  /** 上一次认领或改动失败时的说法，按对话记。 */
  selectorFailureOf = (threadId: string): string | undefined =>
    this.#held.selectorFailure.get(threadId)

  /**
   * 一份答复到手：新开一条、认领一条、重读一条，三条路唯一的落地处。
   *
   * 会话是跟着这条对话一起开出来的，路由、经过、选择器都在同一个答复里，所以这也是
   * 唯一不需要再问一次的时刻。
   *
   * 顺序是有讲究的：#remember 末尾会调 #align，#align 第一件事是问转录忙不忙 ——
   * 事件还没交给转录时它答不忙，于是打开一条正跑着的对话会在那一瞬间挨一次不该发的
   * 切换。经过先落地，再谈对齐。
   */
  opened = (answer: OpenedThread): void => {
    const threadId = answer.thread.threadId

    this.#hold(answer.thread)
    this.#asked.add(threadId)
    this.#transcripts?.adopt(
      threadId,
      answer.events,
      answer.history,
      answer.attachments,
      answer.prompts,
    )
    this.#remember(threadId, answer.selectors)
  }

  /**
   * 这条对话不存在了。
   *
   * 按对话记的每一格都在这个文件里，所以作废它们的地方也只该有这一个。
   */
  forget = (threadId: string): void => {
    this.#asked.delete(threadId)
    this.#actual.delete(threadId)
    this.#tried.delete(threadId)

    /* 在飞的那一次不取消 —— 它已经发出去了，收不回来；只是不再由它驱动下一步。 */
    this.#inflight.delete(threadId)

    /* 会话号那张反查表同样按对话记。#hold 只写不删，这里是它唯一的出口。 */
    for (const [sessionId, owner] of this.#sessions) {
      if (owner === threadId) {
        this.#sessions.delete(sessionId)
      }
    }

    this.#commit({
      selectors: withoutEntry(this.#held.selectors, threadId),
      selectorFailure: withoutEntry(this.#held.selectorFailure, threadId),
    })
  }

  /*
   * 认领一条不是本次运行开出来的对话：让它握住一个会话。
   *
   * 原生侧在同一个答复里给出这条对话现在持有的会话，和 agent 为它报的整张选择器表，
   * 与新开一条对话走的是同一条路 —— 所以选择器只有一个到达口，也就没有「空表」和
   * 「读失败」这两种半状态。
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

    void this.#reopen(threadId)
  }

  retrySelectors = (threadId: string): void => {
    this.#commit({ selectorFailure: withoutEntry(this.#held.selectorFailure, threadId) })
    void this.#reopen(threadId)
  }

  /** 改这条对话的一项会话设置；答案就是改完之后的整张表。 */
  selectControl = (threadId: string, controlId: string, value: string): void => {
    this.#dispatch(threadId, controlId, value)
  }

  /*
   * 下发一次改动，排在这条对话自己的队伍后面。
   *
   * 队列按对话分，不按连接分：两条对话各改各的互不相干，而同一条对话上的两次改动
   * 必须分先后 —— 后一次要用前一次的答复当判据。
   *
   * 失败不把技术原因常驻到会话设置那一格上：那一格说的是「这条对话连没连上 agent」，
   * 一次改动失败不是那件事。这里向 agent 重问一次权威表，UI 因此回到真正生效的值，
   * 是权威回滚，不是本地猜一个旧值填回去。
   */
  #dispatch(threadId: string, controlId: string, value: string): void {
    const config = this.#config

    if (config === undefined) {
      return
    }

    /* 试过就记下，闸门与手动改动共用同一本账。 */
    const record = new Map(this.#tried.get(threadId))

    record.set(controlId, value)
    this.#tried.set(threadId, record)

    const queued = this.#inflight.get(threadId) ?? Promise.resolve()

    const run = queued.then(async () => {
      try {
        const offered = await config.select(threadId, controlId, value)

        this.#remember(threadId, offered)
      } catch {
        await this.#reopen(threadId)
      }
    })

    this.#inflight.set(threadId, run)

    /* run 自己不会拒绝：上面那个 try 把两条路都收了。 */
    void run.then(() => {
      if (this.#inflight.get(threadId) !== run) {
        return
      }

      this.#inflight.delete(threadId)

      /* 队伍空了，再看这条对话还差什么。已经对齐就什么都不做。 */
      this.#align(threadId)
    })
  }

  /*
   * 把这条对话重新打开一次，拿回权威的整张表。
   *
   * 交回一个可等待的东西，因为下发失败之后要先等它落地再谈下一步 —— 不等就会拿着
   * 一张已经作废的 #actual 去决定下一条命令。
   */
  async #reopen(threadId: string): Promise<void> {
    const port = this.#port

    if (port === undefined) {
      return
    }

    this.#asked.add(threadId)

    /* 这一趟要回来的不只是选择器，还有这条对话的经过。 */
    this.#transcripts?.opening(threadId)

    try {
      this.opened(await port.open(threadId))
    } catch (reason: unknown) {
      this.#noteSelectorFailure(threadId, reason)

      /* 同一次失败的两个后果：设置那一格画不出来，对话也打不开。 */
      this.#transcripts?.failed(threadId, reason)
    }
  }

  /*
   * 记下这条对话现在握着哪个会话。
   *
   * 会话是在 port.open() 里诞生（或被装载回来）的，所以那一处就是这张反查表唯一
   * 建立得起来的时刻。列表读回来的那些号不算：它们可能是上一次运行留下的，而推送
   * 只会来自活着的会话。
   */
  #hold(thread: ThreadRecord): void {
    const sessionId = thread.sessionId

    if (sessionId === null) {
      return
    }

    this.#sessions.set(sessionId, thread.threadId)

    /* 同一个事实，转录那一侧也要一份：会话号到手在前，第一帧到达在后。 */
    this.#transcripts?.route(sessionId, thread.threadId)
  }

  /*
   * agent 自己报来了一张新表。
   *
   * 到达口仍然是 #remember —— 与 open 和 select 同一个。所以这不是第三条取数路径，
   * 只是第三个说话的人；失败那一格照样清。
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
   * 两件事在这里分开：agent 报的原话进 #actual（这条会话真在用什么），存进 selectors
   * 的那一份则是投影（屏幕上该显示什么）。共用一格就说不清那格里的东西是哪一个。
   */
  #remember(threadId: string, offered: readonly SessionConfigControl[]): void {
    this.#actual.set(threadId, new Map(offered.map((control) => [control.id, control.current])))
    this.#prune(threadId, offered)

    this.#commit({
      selectors: withEntry(this.#held.selectors, threadId, this.#shown(offered)),
      selectorFailure: withoutEntry(this.#held.selectorFailure, threadId),
    })

    this.#align(threadId)
  }

  /*
   * 换过模型之后，上一次白试的那些不再作数。
   *
   * 闸门记的是"这个值试过了"，而值属于候选集：模型 A 只提供 on/off，试 high 必然
   * 失败；换到提供 high 的模型 B，那条记录仍然拦着同一个目标值，于是它永远不再下发。
   * 判据是"这个值现在还在不在这一项的候选里"，不在就作废 —— 这样一次拒绝仍然只试
   * 一次，而选项集真的换过之后允许再试一次。
   */
  #prune(threadId: string, table: readonly SessionConfigControl[]): void {
    const tried = this.#tried.get(threadId)

    if (tried === undefined) {
      return
    }

    let next: Map<string, string> | undefined

    for (const [controlId, value] of tried) {
      const control = table.find((offered) => offered.id === controlId)

      if (control?.choices.some((choice) => choice.value === value) === true) {
        continue
      }

      next ??= new Map(tried)
      next.delete(controlId)
    }

    if (next === undefined) {
      return
    }

    if (next.size === 0) {
      this.#tried.delete(threadId)

      return
    }

    this.#tried.set(threadId, next)
  }

  /*
   * 全局选中的那个值变了：所有缓存下来的表都要重新投影一次。
   *
   * 这是"投影"与"到达时对齐一次"的分水岭。少了这一步，一条开过的旧对话会永远停在
   * 它第一次打开时的那个值上。
   *
   * 顺带把每条会话真的切过去：屏幕上写着甲、内部握着乙，是比显示错更坏的一种错。
   * #align 自带闸门，重复调用不会重复发命令。
   */
  #realign(): void {
    /*
     * 表在这里捕获一次，两个循环都读它。下面那趟对齐跑在 #commit 之后，读 #held
     * 就会读到新表 —— 今天两张表的键相同，但那是「#shown 不增删键」这个从没写下来
     * 的前提在替它兜底。捕获之后，键从哪来是写死的，不是推断的。
     */
    const held = this.#held.selectors

    /*
     * 不走逐格更新：那是改一格的工具，每改一格复制整张表。这里要改的是每一格，
     * 逐格调用就是 N 张全量拷贝，其中 N-1 张当场变成垃圾。
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
   * 没有可换的就原样交回同一个引用，#commit 因此认得出"没变"，一次多余的提交都
   * 不会发生。
   */
  #shown(table: readonly SessionConfigControl[]): readonly SessionConfigControl[] {
    let changed = false

    const next = table.map((control) => {
      const wanted = this.#choices?.chosenOf(control.id)

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
   * 把这条会话往全局选中的那些值上掰一步。
   *
   * 一次只掰一项。ACP 规定改一项可能增删另一项，所以第二项该不该改、能改成什么，
   * 判据是第一项的答复带回来的那张表 —— 并发发出去的第二条命令用的是一张已经作废
   * 的表，而两条答复各带一整张表，谁后回来谁覆盖 #actual。
   *
   * 判据是 #actual（agent 报的原话），不是屏幕上那份 —— 后者已经被投影过，拿它判
   * 永远得出"已经对上了"。这就是光改显示会撒谎的地方：下一句话仍由旧值来答。
   *
   * 这一轮已经发出去了，中途改人不会让它换个人重答。上游 TUI 在这里直接拒绝用户，
   * 那是单会话终端的前提；我们能同时开多条，选中值是全局那一份，不该被某一条的忙碌
   * 绑架 —— 所以拦的不是人的动作，是这一条下发。空下来时由 start() 里订阅的 onIdle
   * 补上，闸在这里不消耗 #tried。
   */
  #align(threadId: string): void {
    if (this.#config === undefined) {
      return
    }

    const table = this.#held.selectors.get(threadId)
    const actual = this.#actual.get(threadId)

    if (table === undefined || actual === undefined) {
      return
    }

    if (this.#transcripts?.busy(threadId) === true) {
      return
    }

    /* 还有一条在飞。它的答复回来时由队列出口再驱动一次。 */
    if (this.#inflight.has(threadId)) {
      return
    }

    const next = this.#next(table, actual, this.#tried.get(threadId))

    if (next === undefined) {
      return
    }

    this.#dispatch(threadId, next.controlId, next.value)
  }

  /*
   * 下一项该改的是哪个。
   *
   * 模型优先，因为其余各项的取值空间由它决定：先改档位再改模型，那次档位改动会被
   * 模型的答复整个作废，而中间那一刻屏幕上的档位属于上一个模型。
   */
  #next(
    table: readonly SessionConfigControl[],
    actual: ReadonlyMap<string, string>,
    tried: ReadonlyMap<string, string> | undefined,
  ): Pending | undefined {
    let rest: Pending | undefined

    for (const control of table) {
      const wanted = this.#choices?.chosenOf(control.id)

      if (wanted === undefined || wanted === actual.get(control.id)) {
        continue
      }

      if (tried?.get(control.id) === wanted) {
        continue
      }

      if (!control.choices.some((choice) => choice.value === wanted)) {
        continue
      }

      if (control.purpose === 'model') {
        return { controlId: control.id, value: wanted }
      }

      rest ??= { controlId: control.id, value: wanted }
    }

    return rest
  }

  #noteSelectorFailure(threadId: string, reason: unknown): void {
    this.#commit({
      selectorFailure: withEntry(this.#held.selectorFailure, threadId, describeFailure(reason)),
    })
  }

  /* 与 ThreadsStore 的那个同一套写法：没真的变就不通知，判据按 patch 的键走。 */
  #commit(patch: Partial<Held>): void {
    const next: Held = { ...this.#held, ...patch }

    if ((Object.keys(patch) as (keyof Held)[]).every((key) => next[key] === this.#held[key])) {
      return
    }

    this.#held = next
    this.#announce()
  }
}
