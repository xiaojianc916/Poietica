import {
  type AgentCapabilityPort,
  MODEL_CONTROL_ID,
  type SessionConfigControl,
} from '@poietica/acp'
import { useSyncExternalStore } from 'react'

/*
 * 这个 agent 提供哪些可调项，以及每一项此刻选中什么。
 *
 * 形状上只有一个自由变量：模型。其余每一项都是它的派生态。
 *
 * 这不是风格选择，是协议说的：ACP 的 session/new 与 set_config 都回整张表，
 * 理由逐字是 changing one may add or remove another —— 集合本身由模型决定。
 * 把档位与模型摆成同级的两个标量，就是把一个派生量当成了独立事实，于是
 * 「屏幕上写着 Max，会话里报的是 on/off」这类分歧没有任何一处能被发现。
 *
 * 所以 #chosen 分两层：模型一格，其余按模型归档。换模型时旧档位不被删除，
 * 只是不再可见 —— 换回去它还在，而这是「删掉其余选中值」那种写法给不出的。
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
 * 它被交进去而不是被 import 进去。
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

  /* 此刻在位的模型。唯一的自由变量。 */
  #model: string | undefined

  /* 派生项按模型归档：modelId -> (controlId -> value)。 */
  #perModel = new Map<string, Map<string, string>>()

  /*
   * 画出去的那张表是投影。只在 #publish 时算一次 —— useSyncExternalStore 要求
   * 快照引用稳定，每次现算会让它认定状态一直在变而无限重渲染。
   */
  #snapshot: readonly SessionConfigControl[] = NO_CONTROLS

  #listeners = new Set<() => void>()

  #source: AgentCapabilityPort | undefined

  #asked = false

  /*
   * 第几次读取。
   *
   * 此前唯一的守卫是 this.#source !== port，它比的是端口身份而不是请求代次：
   * 同一个端口上并发的两次 read() 都能通过，各自都执行 this.#offered = table，
   * 谁后回来谁赢。那就是「重启一次档位列表就换一套」的机制层原因。
   */
  #generation = 0

  #report: ((cause: unknown) => void) | undefined

  #defaultSource: DefaultModelSource | undefined

  #askedFor: DefaultModelSource | undefined

  /*
   * 配置文件里声明的默认模型。undefined 表示还没问到，null 表示问到了但没有。
   *
   * 它不再当场经由 choose 落定。落定要用 agent 报的真 id，而那个 id 在表到达
   * 之前不存在 —— 此前那条路回落到字面量常量，于是启动瞬间就可能把选择写进一个
   * 谁也不读的键，并顺手把飞行中的读取放回 #asked = false 再发一次。
   */
  #declared: string | null | undefined

  /** 屏幕上那张表。引用只在真的变了时才更换。 */
  snapshot = (): readonly SessionConfigControl[] => this.#snapshot

  /**
   * 这一项此刻选中的是哪个值。
   *
   * 派生项要先有模型才答得出来。这不是防御性判空，是绑定本身：没有模型在位时，
   * 「档位选了什么」这个问题没有答案，而不是答一个上一个模型的旧值。
   */
  chosenOf = (controlId: string): string | undefined => {
    if (controlId === this.#modelId()) {
      return this.#model
    }

    const model = this.#model

    return model === undefined ? undefined : this.#perModel.get(model)?.get(controlId)
  }

  /**
   * 只听，不问。
   *
   * 与 subscribe 的区别只有一处，但那一处要紧：这个不触发读取 —— 会话那一侧在
   * 应用启动时就要听着选中值的变化，而那时屏幕上可能一个选择器都还没有。
   */
  observe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    this.#load()
    this.#loadDeclared()

    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * 人拨动了一个选择器。
   *
   * 这是一次乐观更新，不是一份偏好：真正的下发由 SessionControlsStore 对每条会话
   * 统一去做（observe -> realign）。这里只回答现在要的是哪个。
   *
   * 传 null 就是撤回这一项的选择。
   */
  choose = (controlId: string, value: string | null): void => {
    if (controlId === this.#modelId()) {
      this.#chooseModel(value)

      return
    }

    const model = this.#model

    /*
     * 没有模型在位时不接受派生项的选择。收下它就得先给它找个地方放，而唯一
     * 合法的地方是某个模型底下 —— 放进一个「无主」的格子，就是把刚拆掉的那份
     * 平铺状态又建了一次。
     */
    if (model === undefined) {
      return
    }

    const filed = this.#perModel.get(model)

    if ((filed?.get(controlId) ?? null) === value) {
      return
    }

    const next = new Map(filed)

    if (value === null) {
      next.delete(controlId)
    } else {
      next.set(controlId, value)
    }

    this.#perModel.set(model, next)
    this.#publish()
  }

  /*
   * 换模型。
   *
   * 不清理任何派生项：它们归档在各自的模型底下，换模型之后自动不可见。清理是
   * 上一版的做法，代价是换回原来那个模型时档位也丢了 —— 而人并没有撤回过它。
   *
   * 表要重问：候选由模型决定。代次守卫保证飞行中的旧读取不会覆盖这一次。
   */
  #chooseModel(value: string | null): void {
    if ((this.#model ?? null) === value) {
      return
    }

    this.#model = value ?? undefined

    if (value !== null) {
      this.#asked = false
      this.#load()
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
      this.#load()
    }
  }

  /** 接线时交进来：怎么读、怎么写 agent 配置里的 default_model。 */
  installDefaultModelSource = (source: DefaultModelSource): void => {
    if (this.#defaultSource === source) {
      return
    }

    /*
     * 换了一家 agent。上一家的选中值与归档全都不再成立 —— 留着它们，屏幕会用上
     * 一家的别名冒充这一家的选中项，而自动补齐会以为无事可做。
     */
    this.#defaultSource = source
    this.#declared = undefined
    this.#model = undefined
    this.#perModel = new Map()
    this.#publish()
    this.#loadDeclared()
  }

  /**
   * agent 自己的配置被改过了：这张表不再作数，重问。
   *
   * 首次启动一个 provider 都没配时，read 得到空表，落定那一步因为表里根本没有
   * 模型那一格而提前返回 —— 没有这个显式入口，人在设置页把 provider 导进去之后，
   * 进程里没有任何东西能让它再问一次。
   *
   * 不清空 #offered：重问期间旧表继续画。它仍是 agent 片刻前的真实配置，把工具条
   * 先闪成空的换不到任何正确性。
   */
  refresh = (): void => {
    this.#asked = false
    this.#askedFor = undefined
    this.#declared = undefined

    /* 没人在看就不问：下一个订阅者出现时 subscribe 自会补上。 */
    if (this.#listeners.size > 0) {
      this.#load()
      this.#loadDeclared()
    }
  }

  /*
   * 哪一格是模型，只有这一处说了算。
   *
   * 协议里 purpose 与 id 是两件事。有表时按 purpose 反查真 id；还没有表时回落到
   * 协议常量 —— 那只用于比较，不再用于写入：写入一律等表到达之后由 #settle 落定。
   */
  #modelId(): string {
    return this.#modelControl()?.id ?? MODEL_CONTROL_ID
  }

  #modelControl(): SessionConfigControl | undefined {
    return this.#offered.find((control) => control.purpose === 'model')
  }

  /*
   * 投影：清单来自 #offered，选中值来自这一层。
   *
   * 选中值必须在候选里才画得出来。此前只比 wanted !== current 就替换，于是屏幕能
   * 显示一个 agent 从未接受过的值 —— 人以为开了 Max，其实一次都没生效过。取值空间
   * 由模型决定，所以这道校验不是防御，是这张表的定义。
   */
  #project(): readonly SessionConfigControl[] {
    if (this.#offered.length === 0) {
      return NO_CONTROLS
    }

    return this.#offered.map((control) => {
      const wanted = this.chosenOf(control.id)

      if (wanted === undefined || wanted === control.current) {
        return control
      }

      if (!control.choices.some((choice) => choice.value === wanted)) {
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
   * 「现在在位的是哪个模型」唯一的落定处。
   *
   * 两个输入各自异步到达：表（read）与配置里声明的那个别名（load）。此前它们各自
   * 直接写状态，于是先后顺序决定结果，而两者都能触发对方再跑一次。收敛点只留一个
   * 之后，顺序不再有意义：谁后到，就由谁调这个函数。
   *
   * 已经有模型在位时什么都不做 —— 人的选择胜过配置文件里的声明。
   */
  #settle(): void {
    const model = this.#modelControl()

    if (model === undefined || this.#declared === undefined || this.#model !== undefined) {
      return
    }

    const offers = (alias: string) => model.choices.some((choice) => choice.value === alias)

    /*
     * 配置里声明的那个仍在候选里：直接采用，不写盘 —— 它本来就在文件里。
     */
    if (this.#declared !== null && offers(this.#declared)) {
      this.#chooseModel(this.#declared)

      return
    }

    /*
     * 一个都没选中时替他挑一个，并写进配置。
     *
     * 这是「配好了密钥、模型也列出来了，一发消息却说 Authentication required」的
     * 根治：上游 hasUsableConfiguredDefaultModel 第一行就是 defaultModel 缺席时
     * return false，于是配置文件里的 api_key 整条不算数。挑第一个是稳定的，快照
     * 在 provider-state 里按 provider id 排过序；它只是个起点，不是偏好。
     */
    const save = this.#defaultSource?.save
    const first = model.choices[0]?.value

    if (save === undefined || first === undefined) {
      return
    }

    this.#chooseModel(first)

    void save(first).then(
      () => {
        /*
         * 配置里第一次有了可用的 default_model：锚会话到这一刻才开得起来，而模式
         * 与推理档位正是从那里来的。重问一次，不要让它们等到下次启动。
         */
        this.#asked = false
        this.#load()
      },
      () => {
        /* 没写进去就当没挑过，而不是让屏幕显示一个文件里没有的值。 */
        this.#chooseModel(null)
      },
    )
  }

  #load(): void {
    const port = this.#source

    if (this.#asked || port === undefined) {
      return
    }

    this.#asked = true

    const generation = ++this.#generation

    port
      .read()
      .then((table) => {
        /* 问的时候还是这一家、还是这一次；答回来已经不是了就丢掉。 */
        if (this.#source !== port || generation !== this.#generation) {
          return
        }

        this.#offered = table
        this.#publish()
        this.#settle()
      })
      .catch((cause: unknown) => {
        if (this.#source !== port || generation !== this.#generation) {
          return
        }

        /* 失败之后放回去：下一次有人要看选择器时再问，而不是永久一张空表。 */
        this.#asked = false
        this.#report?.(cause)
      })
  }

  #loadDeclared(): void {
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

        this.#declared = alias
        this.#settle()
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
 * 收下别的一份。
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
