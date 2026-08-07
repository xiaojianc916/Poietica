import type { AgentCapabilityPort, SessionConfigControl } from '@poietica/acp'
import { useSyncExternalStore } from 'react'

/*
 * 这个 agent 提供哪些可调项，以及每一项此刻生效的是什么。
 *
 * 这里只有一份状态：agent 上一次报回来的那张表。模型、模式、推理档位都在表里，
 * 一次答复整张换掉 —— 协议就是这么定义的：ACP 的 session/new 与 set_config 都回
 * 整张表，理由逐字是 changing one may add or remove another。
 *
 * 所以这个类里没有"人选中了什么"的第二份记录。选中就是生效：拨动一个选择器就是
 * 往 agent 发一次 set_config，屏幕上的值一律来自它的答复。此前这里另有一份按模型
 * 归档的选中值与表并列摆着，于是"屏幕上写着 Max"和"会话报的是 on/off"可以长期
 * 各说各话 —— 那不是显示问题，是两份真相。
 */

const NO_CONTROLS: readonly SessionConfigControl[] = []

/**
 * 每一项此刻生效的是什么，以及它什么时候变。
 *
 * 会话那一侧（SessionControlsStore）要的只有这两件事。写成一份显式契约，是为了让
 * 它被交进去而不是被 import 进去。
 */
export interface AgentChoices {
  /** 这一项此刻生效的是哪个值。 */
  readonly chosenOf: (controlId: string) => string | undefined
  /** 只听，不问；返回退订。 */
  readonly observe: (listener: () => void) => () => void
}

class AgentCapabilityStore implements AgentChoices {
  /* 唯一的状态。引用只在 agent 真的报了新表时才更换，useSyncExternalStore 要的
  就是这个稳定性。 */
  #offered: readonly SessionConfigControl[] = NO_CONTROLS

  #listeners = new Set<() => void>()

  #source: AgentCapabilityPort | undefined

  #asked = false

  /*
   * 第几次往返。
   *
   * read 与 select 都交回整张表，而它们可以同时在飞。只比端口身份不够：同一个端口
   * 上并发的两次答复都能通过那道判断，谁后回来谁赢 —— 那就是"重启一次档位列表就换
   * 一套"的机制层原因。代次让晚发的那次胜出，与到达顺序无关。
   */
  #generation = 0

  #report: ((cause: unknown) => void) | undefined

  /** 屏幕上那张表。 */
  snapshot = (): readonly SessionConfigControl[] => this.#offered

  chosenOf = (controlId: string): string | undefined =>
    this.#offered.find((control) => control.id === controlId)?.current

  /**
   * 只听，不问。
   *
   * 与 subscribe 的区别只有一处，但那一处要紧：这个不触发读取 —— 会话那一侧在应用
   * 启动时就要听着，而那时屏幕上可能一个选择器都还没有。
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

    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * 人拨动了一个选择器。
   *
   * 一次往返，没有本地副本：agent 答什么就是什么。不乐观上屏，是因为乐观上屏在这里
   * 只能骗人 —— 取值空间由 agent 决定，它拒绝时屏幕上会留着一个从未生效的值。
   */
  choose = (controlId: string, value: string): void => {
    const port = this.#source
    const control = this.#offered.find((offered) => offered.id === controlId)

    if (port === undefined || control === undefined || control.current === value) {
      return
    }

    /* agent 从没提供过的值不下发：最好的结果是它拒绝，最坏的是它默默换成别的。 */
    if (!control.choices.some((choice) => choice.value === value)) {
      return
    }

    const generation = ++this.#generation

    port
      .select(control, value)
      .then((table) => {
        this.#adopt(port, generation, table)
      })
      .catch((cause: unknown) => {
        if (this.#source !== port || generation !== this.#generation) {
          return
        }

        /* 没改成就重问一次：屏幕上要留 agent 此刻的真实答案，不是我们的意图。 */
        this.#asked = false
        this.#load()
        this.#report?.(cause)
      })
  }

  /**
   * 接线时装上这一家 agent 的那个端口。
   *
   * 端口的身份就是"换没换一家"的判据，所以组合根按 agentId 记住那个对象；同一家
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

  /**
   * agent 自己的配置被改过了：这张表不再作数，重问。
   *
   * 不清空 #offered：重问期间旧表继续画。它仍是 agent 片刻前的真实答复，把工具条
   * 先闪成空的换不到任何正确性。
   */
  refresh = (): void => {
    this.#asked = false

    if (this.#listeners.size > 0) {
      this.#load()
    }
  }

  /* 一张表到手。read 与 select 的答复走同一个口，因为它们是同一样东西。 */
  #adopt(
    port: AgentCapabilityPort,
    generation: number,
    table: readonly SessionConfigControl[],
  ): void {
    /* 问的时候还是这一家、还是这一次；答回来已经不是了就丢掉。 */
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
        this.#adopt(port, generation, table)
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
}

/*
 * 全进程一份。
 *
 * "这个 agent 提供哪些、每一项此刻生效什么"本身就是全进程唯一的事实，所以这里是
 * 一个实例而不是一把自由变量：状态有了主人。
 */
const store = new AgentCapabilityStore()

/**
 * 进程里那一份表，交给需要它的人。
 *
 * 露出去的是一个对象，不是两个自由函数：接收方因此可以在构造时收下它，测试也可以
 * 收下别的一份。
 */
export const agentChoices: AgentChoices = store

export const chooseAgentControl = store.choose
export const installAgentCapabilityPort = store.installPort
export const refreshAgentCapabilities = store.refresh

/** 入口那一格（以及任何还没拿到会话表的那一格）要画的选择器。 */
export function useAgentControls(): readonly SessionConfigControl[] {
  return useSyncExternalStore(store.subscribe, store.snapshot)
}
