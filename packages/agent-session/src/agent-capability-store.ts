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

  #report: ((cause: unknown) => void) | undefined

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

    void port.select(controlId, value).then(
      (table) => {
        this.#adopt(port, generation, table)
      },
      (cause: unknown) => {
        this.#report?.(cause)
      },
    )
  }

  /** 换一个端口（换 agent、或者重连）：旧表当场作废，不留给下一家看。 */
  installPort = (port: AgentCapabilityPort, onFailure?: (cause: unknown) => void): void => {
    if (this.#source === port) {
      return
    }

    this.#source = port
    this.#report = onFailure
    this.#asked = false
    this.#offered = NO_CONTROLS
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
        this.#report?.(cause)
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
