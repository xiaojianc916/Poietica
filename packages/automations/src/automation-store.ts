import { createAutomationId } from '@poietica/core'
import type {
  Automation,
  AutomationCatalog,
  AutomationReschedule,
  AutomationRun,
} from '@poietica/ipc'
import {
  loadAutomations,
  recordAutomationRun,
  removeAutomation,
  upsertAutomation,
} from '@poietica/ipc'
import { warn } from '@poietica/observability'

import { type AutomationDraft, nextOccurrence, nextRunAfter, sameTrigger } from './automation'

/**
 * 自动化的状态与调度。
 *
 * 落盘直接走 @poietica/ipc，不套一层可选注入的端口：可选参数的那种写法里，组合根
 * 忘了注入，编译器不会提醒任何人，整条落盘链路就此静默失效。
 *
 * 屏幕上这份列表是盘上那份的投影，不是与它并行的第二份真相。每一次改动都发一条
 * 按 id 寻址的命令，原生侧串行地读—改—写，再把写完之后的整本目录回给这里；这里
 * 拿它当新的快照。于是没有「先改内存、再补写盘」的窗口，写盘失败时屏幕上也不会
 * 留着一个盘上并不存在的状态。
 *
 * 调度只有一个心跳，真相在 nextRunAt 上：心跳只是叫醒，不是时钟。因此关机期间
 * 错过的那次会在 start() 的第一次 check 里补跑，而不是被静默跳过。
 */

const TICK = 30_000

/**
 * 到期时怎么跑。由组合根注入 —— 这一层不认识 agent，也不认识工作台。
 *
 * 返回这次运行开出来的那条对话；开不出来返回 null。
 */
export type AutomationDispatch = (automation: Automation) => Promise<string | null>

export interface AutomationsViewModel {
  readonly automations: readonly Automation[]
  /** 首帧与「读完了但确实一条都没有」不是同一件事，空态因此不会闪。 */
  readonly loaded: boolean
}

export interface AutomationStore {
  readonly getSnapshot: () => AutomationsViewModel
  readonly subscribe: (listener: () => void) => () => void
  readonly create: (draft: AutomationDraft) => void
  /** 改一条已有的。触发条件没变就不重排下一次运行。 */
  readonly update: (id: string, draft: AutomationDraft) => void
  readonly remove: (id: string) => void
  readonly setEnabled: (id: string, enabled: boolean) => void
  readonly runNow: (id: string) => void
  /** 启动调度，返回停表函数。与 ThreadsStore.start 同一条纪律。 */
  readonly start: (dispatch: AutomationDispatch) => () => void
}

export function createAutomationStore(): AutomationStore {
  let snapshot: AutomationsViewModel = { automations: [], loaded: false }
  const listeners = new Set<() => void>()

  /* 一条自动化同时只有一次运行在飞：慢的那次不会被下一个心跳重复点火。 */
  const inFlight = new Set<string>()
  let dispatch: AutomationDispatch | null = null

  /*
   * 回程的排序。
   *
   * 原生侧按到达顺序串行写盘，但回程可以乱序抵达：先发的那条后回，它带回来的
   * 就是一份更旧的目录，贴上去屏幕会倒退一格。号码单调递增，只有不比已经贴上
   * 去的那张更旧的号才作数 —— 与浏览器里处理 fetch 竞态的做法同一条规矩。
   */
  let issued = 0
  let applied = 0

  function publish(next: AutomationsViewModel): void {
    snapshot = next

    for (const listener of listeners) {
      listener()
    }
  }

  /** 领一张号，用它接住一次回程。过期的号什么也不做。 */
  function ticket(): (automations: readonly Automation[]) => void {
    issued += 1
    const mine = issued

    return (automations) => {
      if (mine < applied) {
        return
      }

      applied = mine
      publish({ automations, loaded: true })
    }
  }

  /**
   * 发一条写命令，把原生侧回来的那本目录贴到屏幕上。
   *
   * 失败时不动屏幕：这里没有需要回滚的乐观更新，屏幕上仍然是盘上那一份，人看到
   * 的就是这次确实没改成。但不吞掉 —— 交给可观测通道。
   */
  function command(send: () => Promise<AutomationCatalog>): void {
    const settle = ticket()

    void send()
      .then((catalog) => {
        settle(catalog.automations)
      })
      .catch((cause: unknown) => {
        warn('自动化没能写入磁盘，屏幕上仍是磁盘里那一份', {
          scope: 'automations',
          cause,
        })
      })
  }

  function lookup(id: string): Automation | undefined {
    return snapshot.automations.find((candidate) => candidate.id === id)
  }

  /**
   * 点一次火。origin 分清是谁点的：日程到点（'schedule'），还是人按了试运行
   * （'manual'）。手动运行不碰日程 —— cron、Temporal 与 Kubernetes 的手动
   * 触发都不改写周期计划，这里同一条规矩。
   */
  async function fire(automation: Automation, origin: 'schedule' | 'manual'): Promise<void> {
    /*
     * 先快照，再用。两个理由，缺一个都会出事：
     *
     *   1. dispatch 是模块作用域里可变的 AutomationDispatch | null。只有快照成
     *      const，null 检查之后的收窄才活得过下面那个 await —— 直接判 dispatch
     *      再 await dispatch(...)，收窄会在 await 处失效。
     *   2. start() 返回的停表函数会把 dispatch 置回 null。分两次读，就可能一次
     *      非空、一次为空。
     *
     * 名字叫 invoke 不叫 run：run 归 AutomationRun —— 那是这个领域里的名词，
     * 不该被一个装着函数的局部变量占着。
     */
    const invoke = dispatch

    if (invoke === null || inFlight.has(automation.id)) {
      return
    }

    inFlight.add(automation.id)

    const startedAt = new Date().toISOString()
    let threadId: string | null = null

    try {
      threadId = await invoke(automation)
    } catch (cause: unknown) {
      warn('自动化这次没有跑起来', { scope: 'automations', cause })
    } finally {
      inFlight.delete(automation.id)
    }

    /*
     * 先具名，再提交。标注让三元里的 'failed' | 'succeeded' 收在 AutomationRun
     * 的联合上，而不是被拓宽成 string。
     *
     * 结局记的是「这次运行有没有开起来」：对话开出来、指令经唯一的发送管线提交，
     * 就是 succeeded。指令那一轮本身的成败由那条对话自己回答 —— 运行就是一条
     * 对话，账本不存第二份运行状态。
     */
    const run: AutomationRun = {
      threadId,
      startedAt,
      outcome: threadId === null ? 'failed' : 'succeeded',
    }

    /*
     * 锚点是刚刚到期的那个时刻，不是跑完的这一刻 —— 固定速率，相位不随执行时长
     * 漂移。
     *
     * 「运行期间日程有没有被人动过」这一问不在这里回答：这里手上只有一份可能已经
     * 过时的副本，拿副本比副本等于没比。from 送过去，由持有真相的那一侧比对。
     */
    const anchor = automation.nextRunAt
    const reschedule: AutomationReschedule =
      origin === 'schedule' && anchor !== null
        ? {
            kind: 'advance',
            from: anchor,
            to: nextOccurrence(automation.trigger, Date.parse(anchor), Date.now()),
          }
        : { kind: 'keep' }

    command(() => recordAutomationRun({ id: automation.id, run, reschedule }))
  }

  /** 到期判定。启动时也走这一段，于是关机期间错过的那次就是「已经到期」。 */
  function check(): void {
    const now = Date.now()

    for (const automation of snapshot.automations) {
      if (!automation.enabled || automation.nextRunAt === null) {
        continue
      }

      if (Date.parse(automation.nextRunAt) <= now) {
        void fire(automation, 'schedule')
      }
    }
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },

    create(draft) {
      const now = Date.now()

      command(() =>
        upsertAutomation({
          id: createAutomationId(),
          title: draft.title,
          prompt: draft.prompt,
          trigger: draft.trigger,
          sessionConfig: { ...draft.sessionConfig },
          enabled: draft.trigger.kind !== 'manual',
          createdAt: new Date(now).toISOString(),
          nextRunAt: nextRunAfter(draft.trigger, now),
          runs: [],
        }),
      )
    },

    update(id, draft) {
      const current = lookup(id)

      if (current === undefined) {
        return
      }

      command(() =>
        upsertAutomation({
          ...current,
          title: draft.title,
          prompt: draft.prompt,
          trigger: draft.trigger,
          sessionConfig: { ...draft.sessionConfig },

          /*
           * 只有触发条件真的变了才重排。否则改一个错别字，interval 那条的下一次
           * 运行就被推后一整个周期 —— 人动的是提示词，不是日程。
           *
           * 停用状态下 nextRunAt 本来就是 null（见 setEnabled），照原样留着即可。
           */
          nextRunAt:
            current.enabled && !sameTrigger(current.trigger, draft.trigger)
              ? nextRunAfter(draft.trigger, Date.now())
              : current.nextRunAt,
        }),
      )
    },

    remove(id) {
      command(() => removeAutomation(id))
    },

    setEnabled(id, enabled) {
      const current = lookup(id)

      if (current === undefined) {
        return
      }

      /*
       * 重新启用时下一次到期从此刻重新起算，不是接着那个早已过期的时刻 ——
       * 否则一停一开，人立刻挨一次补跑，那不是他按下开关时想要的。
       */
      command(() =>
        upsertAutomation({
          ...current,
          enabled,
          nextRunAt: enabled ? nextRunAfter(current.trigger, Date.now()) : null,
        }),
      )
    },

    runNow(id) {
      const automation = lookup(id)

      if (automation !== undefined) {
        void fire(automation, 'manual')
      }
    },

    start(next) {
      dispatch = next

      const settle = ticket()

      void loadAutomations()
        .then((catalog) => {
          settle(catalog.automations)
          check()
        })
        .catch((cause: unknown) => {
          warn('自动化列表读取失败', { scope: 'automations', cause })
          settle([])
        })

      const timer = setInterval(check, TICK)

      return () => {
        clearInterval(timer)
        dispatch = null
      }
    },
  }
}
