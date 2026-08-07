import type { AgentCapabilityPort, SessionConfigControl } from '@poietica/acp'
import { useSyncExternalStore } from 'react'

/*
 * 锚会话提供哪些可调项，以及每一项此刻生效的是什么。
 *
 * 只有一份状态：agent 上一次报回来的那张表。模型、模式、推理档位都在表里，一次
 * 答复整张换掉 —— 协议就是这么定义的：ACP 的 session/new 与 set_config 都回整张
 * 表，理由逐字是 changing one may add or remove another。
 *
 * 所以这里没有"人选中了什么"的第二份记录。选中就是生效：拨动一个选择器就是往
 * agent 发一次 set_config，屏幕上的值一律来自它的答复。
 *
 * 这张表只描述锚会话自己，它不是"全局选中值"，也不向任何人广播。别的对话各自
 * 握着自己的会话，值问它们自己的会话要 —— ACP 的配置是会话级的，一条会话选了
 * 什么说明不了另一条选了什么。跨会话真正被继承的只有一件事：换模型时先写进
 * config.toml 的 default_model，agent 用它开下一条会话。那条继承走 agent，不走
 * 这一层，并且只对之后新建的会话生效。
 */

const NO_CONTROLS: readonly SessionConfigControl[] = []

/*
 * 读不到，和改不动，是两件事。
 *
 * 此前它们共用一个回调，于是组合根只能报同一个码、同一句话：一次改动被 agent
 * 拒了，屏幕上写的却是「没能读到可用的模型，去看看密钥填了没有」—— 把人支去检查
 * 一把本来就是对的钥匙。让人去修没坏的东西，是错误模型能犯的最贵的一种错。
 */
export interface CapabilityFailureReport {
  /** 读整张表没成。屏幕上一个选项都没有。 */
  readonly readFailed: (cause: unknown) => void
  /** 改一项没成。表还在，只是这一次没生效。 */
  readonly changeFailed: (cause: unknown) => void
}

/**
 * 一家 agent 的锚会话表。
 *
 * 导出这个类，而不只导出进程里那一个实例：它不认识 React、不认识进程、也不认识
 * IPC，只认一个端口，所以测试能各造一份自己的来跑，用例之间没有先后可言。
 */
export class AgentCapabilityStore {
  /* 唯一的状态。引用只在 agent 真的报了新表时才更换，useSyncExternalStore 要的
     就是这个稳定性。 */
  #offered: readonly SessionConfigControl[] = NO_CONTROLS

  #listeners = new Set<() => void>()

  #source: AgentCapabilityPort | undefined

  /* 问过就不再问第二遍：重读是显式动作（refresh），不是渲染的副作用。 */
  #asked = false

  /*
   * 第几次往返。
   *
   * read 与 select 都在飞的时候，谁后回来谁赢是错的 —— 该赢的是谁问得晚。代次
   * 对不上的答复直接丢掉，这就是"重启一次档位列表就换一套"这类事故的机制层根因。
   */
  #generation = 0

  #report: CapabilityFailureReport | undefined

  /* 听 agent 说话的那根线。换端口时先断，否则上一家还在替这一家发号施令。 */
  #unsubscribe: (() => void) | undefined

  /** 屏幕上那张表。 */
  snapshot = (): readonly SessionConfigControl[] => this.#offered

  /** 订阅这张表，并顺手把第一次读取带起来。 */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    this.#load()

    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * 在锚会话上改一项设置。
   *
   * agent 从没提供过的值不下发：候选集由它说了算，发一个它给不出的值只会换回一个
   * 错误。答复就是改完之后的整张表，原样存下。
   */
  choose = (controlId: string, value: string): void => {
    const control = this.#offered.find((offered) => offered.id === controlId)

    if (control === undefined || control.current === value) {
      return
    }

    if (!control.choices.some((choice) => choice.value === value)) {
      return
    }

    const port = this.#source

    if (port === undefined) {
      return
    }

    this.#generation += 1

    const generation = this.#generation

    /*
     * 交出去的是整个控件。
     *
     * 端口的签名就是这么定的，理由也写在那里（@poietica/acp 的 capability.ts）：
     * 桌面那一侧要靠 purpose 认出「模型那一格」才会去写 config.toml 的
     * default_model，而 id 是 agent 自己起的名字，协议没规定过。传一个字符串过去，
     * purpose 读出 undefined、configId 读出 undefined —— 前者让换模型不再落盘，
     * 后者让命令在原生侧连反序列化都过不了。
     */
    void port.select(control, value).then(
      (table) => {
        this.#adopt(port, generation, table)
      },
      (cause: unknown) => {
        this.#report?.changeFailed(cause)

        /* 改不动就把权威重新问一遍：屏幕必须等于 agent 真在用的东西。这一趟不
        惊动 agent —— 驱动器拿它手上那张表就地作答（driver.rs 的
        Command::Selectors），代价只是一次进程内往返。 */
        this.refresh()
      },
    )
  }

  /** 换一个端口（换 agent、或者重连）：旧表当场作废，不留给下一家看。 */
  installPort = (port: AgentCapabilityPort, report?: CapabilityFailureReport): void => {
    if (this.#source === port) {
      return
    }

    this.#unsubscribe?.()

    this.#source = port
    this.#report = report
    this.#asked = false
    this.#offered = NO_CONTROLS

    /*
     * agent 一改主意就重读。
     *
     * 这张表此前只有一条到达路径：我们问，它答。而 agent 纠正自己用的是另一条 ——
     * 换完模型它会补推一张收敛过的表（thought 的候选集属于模型，换了模型就得换）。
     * 没有这根线的时候，屏幕上留着的是上一个模型的档位列表，直到下一次有人再问。
     *
     * 收到就重读，而不是把推来的表直接吃下：那一声没带可判定的归属，而锚会话此刻
     * 是什么，问一次就有权威答案 —— 那一趟由驱动器就地作答，不惊动 agent。
     */
    this.#unsubscribe = port.subscribe?.(() => {
      this.refresh()
    })

    this.#publish()
    this.#load()
  }

  /** 显式重读一次。 */
  refresh = (): void => {
    this.#asked = false
    this.#load()
  }

  /*
   * 一张表到了。端口和代次都得对得上，否则它属于一个已经过去的问题。
   */
  #adopt(
    port: AgentCapabilityPort,
    generation: number,
    table: readonly SessionConfigControl[],
  ): void {
    if (this.#source !== port || generation !== this.#generation) {
      return
    }

    this.#offered = table
    this.#publish()
  }

  #publish(): void {
    for (const listener of this.#listeners) {
      listener()
    }
  }

  /*
   * 没人在看就不读：读取是为了画出来，屏幕上没有这张表时那一趟往返没有收货人。
   */
  #load(): void {
    const port = this.#source

    if (port === undefined || this.#asked || this.#listeners.size === 0) {
      return
    }

    this.#asked = true
    this.#generation += 1

    const generation = this.#generation

    void port.read().then(
      (table) => {
        this.#adopt(port, generation, table)
      },
      (cause: unknown) => {
        /* 失败不算问过：下一个看的人还能再试一次。 */
        this.#asked = false
        this.#report?.readFailed(cause)
      },
    )
  }
}

/* 进程里那一份：入口那格画的就是它。 */
const store = new AgentCapabilityStore()

export const chooseAgentControl = store.choose

export const installAgentCapabilityPort = store.installPort

export const refreshAgentCapabilities = store.refresh

/**
 * 入口那一格要画的选择器。
 *
 * 已经进了某条对话之后画的是那条对话自己的表（ThreadsStore 的 selectorsOf），
 * 不是这一张 —— 那条会话此刻在用什么，只有它自己知道。
 */
export function useAgentControls(): readonly SessionConfigControl[] {
  return useSyncExternalStore(store.subscribe, store.snapshot)
}
