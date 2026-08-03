import type {
  SessionConfigControl,
  SessionConfigPort,
  SessionConfigReport,
  ThreadPort,
  ThreadRecord,
} from '@poietica/acp'
import { agentChosen, observeAgentControls } from './agent-capability-store'
import { describeFailure } from './describe-failure'
import { withEntry, withoutEntry } from './immutable-map'
import type { TranscriptSink } from './transcript-sink'

/** 打开一条对话拿回来的那一整份答复。形状由端口说了算，不另抄一遍。 */
type OpenedThread = Awaited<ReturnType<ThreadPort['open']>>

interface Held {
  readonly selectors: ReadonlyMap<string, readonly SessionConfigControl[]>
  readonly selectorFailure: ReadonlyMap<string, string>
}

const EMPTY: Held = { selectors: new Map(), selectorFailure: new Map() }

/**
 * 一条对话背后那个会话：它握着哪些值，还能选什么，以及把它掰到全局选中值上。
 *
 * 与对话列表分开，是因为它们本来就是两样东西。列表是一批记录（名字、活动时间、
 * 置顶），来自一次整表读取；这里是一台持续运行的对齐引擎 —— observeAgentControls
 * 推一下，#realign 扫一遍，#align 逐条比对 #actual 与全局值，切换的答复回到
 * #remember，再触发一次 #align。它自己会转，而列表不会。
 *
 * 两者此前同住一个快照，代价写在 ThreadsStore 的 #commit 里：那里按字段分流，
 * 只有 threads / pending / provisional 变了才重算列表。一个 store 需要这种分流，
 * 就说明它装着两份状态。
 *
 * 通知仍然汇回 ThreadsStore 那一条订阅（构造时交进来的 announce）。读谁的状态，
 * 和怎么被叫醒，是可以分两步走的两件事；这一刀只动前者，界面行为逐字不变。
 */
export class SessionControlsStore {
  readonly #port: ThreadPort | undefined

  readonly #config: SessionConfigPort | undefined

  readonly #transcripts: TranscriptSink | undefined

  readonly #announce: () => void

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
   * 切换失败会走 catch 里的重读，重读又会得出同一个结论 —— 没有这道闸，一次 agent
   * 拒绝就是一个不停打命令的循环。换一个目标值时重新允许。
   */
  #tried = new Map<string, ReadonlyMap<string, string>>()

  constructor(
    port: ThreadPort | undefined,
    config: SessionConfigPort | undefined,
    transcripts: TranscriptSink | undefined,
    announce: () => void,
  ) {
    this.#port = port
    this.#config = config
    this.#transcripts = transcripts
    this.#announce = announce
  }

  snapshot = (): Held => this.#held

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
   * 顺序是有讲究的，而此前两条路各写各的：create 先 adopt 再 remember，#read 反过来。
   * #remember 末尾会调 #align，#align 第一件事是问转录忙不忙 —— 事件还没交给转录时，
   * 它答不忙。于是打开一条正跑着的对话，会在那一瞬间挨一次不该发的模型切换。
   * 经过先落地，再谈对齐。
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
   * 按对话记的每一格都在这个文件里，所以作废它们的地方也只该有这一个。此前它们摊在
   * ThreadsStore.remove 里逐格删，五格漏一格就是一次静默的泄漏。
   */
  forget = (threadId: string): void => {
    this.#asked.delete(threadId)
    this.#actual.delete(threadId)
    this.#tried.delete(threadId)

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
    this.#commit({ selectorFailure: withoutEntry(this.#held.selectorFailure, threadId) })
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
      .then((answer) => {
        this.opened(answer)
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
      selectors: withEntry(this.#held.selectors, threadId, this.#shown(offered)),
      selectorFailure: withoutEntry(this.#held.selectorFailure, threadId),
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
