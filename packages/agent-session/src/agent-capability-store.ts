import {
  type AgentCapabilityPort,
  MODEL_CONTROL_ID,
  type SessionConfigControl,
} from '@poietica/acp'
import { useSyncExternalStore } from 'react'

/*
 * 这个 agent 提供哪些可调项，以及每一项此刻选中什么。
 *
 * 三件生命周期不同的事，分三处：
 *
 *   · 提供哪些：属于 agent 的配置与握手。问一次，全进程共用（产地见组合根的
 *     desktopAgentCapabilities）。
 *   · 选中哪个：属于人，不属于任何一条会话 —— 入口那一格没有会话，照样要选得动。
 *   · 某条会话此刻真在用哪个：属于那条会话，由 ThreadsStore 按 threadId 保管，并
 *     由它把会话对齐到这里选中的值。
 *
 * 模型不特殊，只多一件事：它有家，就是 agent 配置里的顶层 default_model。其余的
 * 没有落盘的地方，也就不落 —— 落了就是第二个家。
 *
 * 形制与 ThreadsStore 一致：状态收在一个实例里，改动经由 #publish 落定。此前它摊
 * 在模块作用域的十个可变量上，谁都能改、谁都不拥有，测试也拿不到干净实例 —— 而同
 * 一个目录下的 transcript-store 开篇就在论证模块级可变状态不可取。一个包不该有两
 * 套关于「状态放哪」的答案。
 */

const NO_CONTROLS: readonly SessionConfigControl[] = []

/*
 * default_model 从哪里读、往哪里写。
 *
 * 这个包不认识 AgentConfigStore，也不该认识 —— 它只要两个函数：问一次，和写一次。
 */
interface DefaultModelSource {
  readonly load: () => Promise<string | null>
  readonly save: (alias: string) => Promise<unknown>
}

/**
 * 人此刻选中了哪些值，以及它什么时候变。
 *
 * 会话那一侧（SessionControlsStore）要的只有这两件事。写成一份显式契约，是为了让
 * 它被交进去而不是被 import 进去：那台对齐引擎的另外四个依赖本来就是构造时交进来
 * 的，唯独这一条伸手拿进程单例 —— 于是它没法在没有这个单例的情况下被构造，而这个
 * 目录下最大的两个 store 一行测试都没有，同目录的 transcript-store 有。
 */
export interface AgentChoices {
  /** 这一项此刻选中的是哪个值。 */
  readonly chosenOf: (controlId: string) => string | undefined
  /** 只听，不问；返回退订。 */
  readonly observe: (listener: () => void) => () => void
}

class AgentCapabilityStore implements AgentChoices {
  /* 这个 agent 提供的整张表。只在内存里：权威是它自己的配置。 */
  #offered: readonly SessionConfigControl[] = NO_CONTROLS

  /* 每一项选中什么，按 controlId 记。 */
  #chosen = new Map<string, string>()

  /*
   * 画出去的那张表是投影：清单来自 #offered，选中值来自 #chosen。
   *
   * 只在 #publish 时算一次，不在每次读取时算 —— useSyncExternalStore 要求快照引用
   * 稳定，每次现算会让它认定"状态一直在变"而无限重渲染。
   */
  #snapshot: readonly SessionConfigControl[] = NO_CONTROLS

  #listeners = new Set<() => void>()

  /*
   * 清单从哪里来，以及什么时候去问。
   *
   * 端口在接线时装上，装上本身不问：真正那次读取要等第一个订阅者出现 —— 也就是屏幕
   * 上真的有一个选择器要画的时候。一个从没打开过助手的启动不为此付钱。
   */
  #source: AgentCapabilityPort | undefined

  #asked = false

  #report: ((cause: unknown) => void) | undefined

  #defaultSource: DefaultModelSource | undefined

  /*
   * 已经问过的那一份来源。
   *
   * 记的不是「问过没有」，是「问的是哪一份」：来源按 agent 接进来，换一家会重新
   * install，一个布尔会把新那家永远挡在门外。
   */
  #askedFor: DefaultModelSource | undefined

  /*
   * 那一次读取回来过没有。
   *
   * 不能拿"没有选中值"当这个问题的答案：还没问到的时候也是没有，而自动补齐正是靠
   * 这个判断决定要不要写入 —— 分不清「确实没有」与「还不知道」，就会拿第一个候选盖
   * 掉人原本配好的那个。只在读取成功时置位。
   */
  #defaultKnown = false

  /** 屏幕上那张表。引用只在真的变了时才更换。 */
  snapshot = (): readonly SessionConfigControl[] => this.#snapshot

  /**
   * 这一项此刻选中的是哪个值。
   *
   * 会话那一侧要拿它把自己对齐过来：一条旧对话记着别的值是它自己的历史，不是
   * "现在选中什么"的答案。这个函数就是那个答案唯一的产地。
   */
  chosenOf = (controlId: string): string | undefined => this.#chosen.get(controlId)

  /**
   * 只听，不问。
   *
   * 与 subscribe 的区别只有一处，但那一处要紧：这个不调 #loadOnce。挂一个监听器不该
   * 把 agent 叫起来 —— 会话那一侧在应用启动时就要听着选中值的变化，而那时屏幕上可能
   * 一个选择器都还没有。
   */
  observe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    this.#loadOnce()
    this.#loadDefaultOnce()

    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * 人拨动了一个选择器，或者刚从配置里读到 default_model。
   *
   * 这是一次乐观更新，不是一份偏好：真正的下发由 SessionControlsStore 对每条会话
   * 统一去做（observe → #realign → #align）。这里只回答"现在要的是哪个"。
   *
   * 传 null 就是撤回这一项的选择。
   */
  choose = (controlId: string, value: string | null): void => {
    if ((this.#chosen.get(controlId) ?? null) === value) {
      return
    }

    if (value === null) {
      this.#chosen.delete(controlId)
    } else {
      this.#chosen.set(controlId, value)
    }

    if (controlId === this.#modelId()) {
      /*
       * 这张表的身份是 (agent, model)，不是 (agent)。
       *
       * 模式与推理档位的候选由模型决定 —— ACP 的 session/new 连同 models 一起报出它
       * 们，set_model 之后报的是新的一份。此前这里只换了模型，表却留着上一个模型报
       * 的候选：入口画着 Off/High/Max，会话那一侧的真会话报的是 on/off。
       *
       * 旧值一并撤回。它属于上一个模型的取值空间，对齐时被 choices 校验静默丢弃，而
       * 屏幕上仍写着它 —— 人以为开了 Max，其实一次都没生效过。
       */
      for (const id of [...this.#chosen.keys()]) {
        if (id !== controlId) {
          this.#chosen.delete(id)
        }
      }

      /* 撤回不带来新模型，也就没有新的一张表可问。 */
      if (value !== null) {
        this.#asked = false
        this.#loadOnce()
      }
    }

    this.#publish()
  }

  /**
   * 接线时装上取整张表的那一路。
   *
   * 端口的身份就是「换没换一家」的判据，所以组合根按 agentId 记住那个对象；同一家
   * 反复装上是幂等的，换一家则连表一起归零。
   */
  installPort = (port: AgentCapabilityPort, onFailure?: (cause: unknown) => void): void => {
    this.#report = onFailure

    if (this.#source === port) {
      return
    }

    this.#source = port
    this.#asked = false
    this.#offered = NO_CONTROLS
    this.#publish()

    /* 已经有人在看选择器了才立刻问；没有就仍旧等第一个订阅者。 */
    if (this.#listeners.size > 0) {
      this.#loadOnce()
    }
  }

  /** 接线时交进来：怎么读、怎么写 agent 配置里的 default_model。 */
  installDefaultModelSource = (source: DefaultModelSource): void => {
    if (this.#defaultSource === source) {
      return
    }

    /*
     * 换了一家 agent。上一家的选中值和「已经问到了」两件事都不再成立 —— 留着它们，屏
     * 幕会用上一家的别名冒充这一家的选中项，而自动补齐会以为无事可做。
     */
    this.#defaultSource = source
    this.#defaultKnown = false
    this.choose(this.#modelId(), null)
    this.#loadDefaultOnce()
  }

  /**
   * agent 自己的配置被改过了：这张表不再作数，重问。
   *
   * 为什么需要一个显式入口：#asked 只在「换了一家 agent」「自动补默认模型写盘成功」
   * 「这一次读取失败」三种情形下放回 false。首次启动一个 provider 都没配时，read 得
   * 到空表，#ensureDefaultModel 因为表里根本没有模型那一格而提前 return —— 三条路一
   * 条都没走到，#asked 就此永远为真。人在设置页把 provider 导进去之后，进程里没有任
   * 何东西能让它再问一次。
   *
   * 不清空 #offered：重问期间旧表继续画。它仍是 agent 片刻前的真实配置，把工具条先
   * 闪成空的换不到任何正确性（stale-while-revalidate，与设置页那份同一套做法）。
   *
   * default_model 一起重读，这一条不能省。刚才那次导入很可能已经把它写进配置了。若
   * 只放回 #asked，能力表回来时 #chosen 里还没有模型，#ensureDefaultModel 就会拿
   * choices[0] 写盘 —— 把人刚导进去的那个默认模型盖掉。
   */
  refresh = (): void => {
    this.#asked = false
    this.#askedFor = undefined
    this.#defaultKnown = false

    /* 没人在看就不问：下一个订阅者出现时 subscribe 自会补上。 */
    if (this.#listeners.size > 0) {
      this.#loadOnce()
      this.#loadDefaultOnce()
    }
  }

  /*
   * 哪一格是模型，只有这一处说了算。
   *
   * 协议里 purpose 与 id 是两件事（SessionConfigPurpose 与 MODEL_CONTROL_ID），此前
   * 这个文件把后者同时当成两者用：写 #chosen 时当 id，find 时拿去比 purpose ——
   * 两个字面量恰好都是 "model" 才编译得过。agent 报的 id 一旦不叫 model，配置里的
   * default_model 就写进了一个谁也不读的键，而对齐按 control.id 查，于是"设置里选了
   * 默认模型，会话里没生效"。
   *
   * 有表时按 purpose 反查真 id；还没有表时回落到协议常量 —— 那正是启动后第一次读取
   * 之前的那一小段。
   */
  #modelId(): string {
    return this.#modelControl()?.id ?? MODEL_CONTROL_ID
  }

  #modelControl(): SessionConfigControl | undefined {
    return this.#offered.find((control) => control.purpose === 'model')
  }

  #project(): readonly SessionConfigControl[] {
    if (this.#offered.length === 0) {
      return NO_CONTROLS
    }

    return this.#offered.map((control) => {
      const wanted = this.#chosen.get(control.id)

      if (wanted === undefined || wanted === control.current) {
        return control
      }

      return { ...control, current: wanted }
    })
  }

  #publish(): void {
    this.#snapshot = this.#project()

    for (const listener of this.#listeners) {
      listener()
    }
  }

  /*
   * 一个模型都没选中时，替他挑一个。
   *
   * 这是「配好了密钥、模型也列出来了，一发消息却说 Authentication required」的根治：
   * 上游 hasUsableConfiguredDefaultModel 第一行就是 defaultModel 缺席时 return false，
   * 于是配置文件里的 api_key 整条不算数。
   *
   * 挑第一个是稳定的：快照在 provider-state 里按 provider id 排过序。挑出来的只是个
   * 起点，不是偏好 —— 人拨一下它就变了。
   */
  #ensureDefaultModel(): void {
    const save = this.#defaultSource?.save
    const model = this.#modelControl()

    if (!this.#defaultKnown || save === undefined || model === undefined) {
      return
    }

    if (this.#chosen.get(model.id) !== undefined) {
      return
    }

    const first = model.choices[0]?.value

    if (first === undefined) {
      return
    }

    this.choose(model.id, first)

    void save(first).then(
      () => {
        /*
         * 配置里第一次有了可用的 default_model：锚会话到这一刻才开得起来，而模式与推
         * 理档位正是从那里来的。重问一次，不要让它们等到下次启动。
         */
        this.#asked = false
        this.#loadOnce()
      },
      () => {
        /* 没写进去就当没挑过，而不是让屏幕显示一个文件里没有的值。 */
        this.choose(model.id, null)
      },
    )
  }

  #loadOnce(): void {
    const port = this.#source

    if (this.#asked || port === undefined) {
      return
    }

    this.#asked = true
    port
      .read()
      .then((table) => {
        /* 问的时候还是这一家，答回来已经换了人。 */
        if (this.#source !== port) {
          return
        }

        this.#offered = table
        this.#publish()

        /* 候选可能是这一刻才第一次到达的：那正是"该不该替他挑一个"重新有答案的时刻。 */
        this.#ensureDefaultModel()
      })
      .catch((cause: unknown) => {
        if (this.#source !== port) {
          return
        }

        /* 失败之后放回去：下一次有人要看选择器时再问，而不是永久一张空表。 */
        this.#asked = false
        this.#report?.(cause)
      })
  }

  #loadDefaultOnce(): void {
    const asking = this.#defaultSource

    if (asking === undefined || this.#askedFor === asking) {
      return
    }

    this.#askedFor = asking
    asking
      .load()
      .then((alias) => {
        /* 问的时候还是这一家，答回来已经换了人：这个答案不是给现在这一格的。 */
        if (this.#defaultSource !== asking) {
          return
        }

        this.#defaultKnown = true
        this.choose(this.#modelId(), alias)
        this.#ensureDefaultModel()
      })
      .catch(() => {
        if (this.#askedFor === asking) {
          this.#askedFor = undefined
        }
      })
  }
}

/*
 * 全进程一份。
 *
 * 「这个 agent 提供哪些、人此刻选中哪个」本身就是全进程唯一的事实，所以这里是一个
 * 实例而不是十个自由变量：状态有了主人。
 */
const store = new AgentCapabilityStore()

/**
 * 进程里那一份选择，交给需要它的人。
 *
 * 露出去的是一个对象，不是两个自由函数：接收方因此可以在构造时收下它，测试也可以
 * 收下别的一份 —— 两个 import 进去的函数做不到这件事。
 */
export const agentChoices: AgentChoices = store

export const chooseAgentControl = store.choose
export const installAgentCapabilityPort = store.installPort
export const installAgentDefaultModelSource = store.installDefaultModelSource
export const refreshAgentCapabilities = store.refresh

/** 入口那一格（以及任何还没拿到会话表的那一格）要画的选择器。 */
export function useAgentControls(): readonly SessionConfigControl[] {
  return useSyncExternalStore(store.subscribe, store.snapshot)
}
