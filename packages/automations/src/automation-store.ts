import { createAutomationId } from '@poietica/core'
import type { Automation, AutomationCatalog, AutomationRun } from '@poietica/ipc'
import { loadAutomations, saveAutomations } from '@poietica/ipc'
import { warn } from '@poietica/observability'

import {
  type AutomationDraft,
  nextOccurrence,
  nextRunAfter,
  RUN_HISTORY_LIMIT,
  sameTrigger,
} from './automation'

/**
 * 自动化的状态与调度。
 *
 * 落盘直接走 @poietica/ipc，不套一层可选注入的端口：可选参数的那种写法里，组合根
 * 忘了注入，编译器不会提醒任何人，整条落盘链路就此静默失效。
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
   * 首次加载在飞期间，人有没有动过这份列表。
   *
   * 动过，内存里这份就比盘上读回来的那份新（改动在 commit 里已经 persist
   * 落盘）。加载完成时拿旧的盖新的，屏幕上刚建的那条当场消失，而盘上还
   * 在 —— 屏幕与盘就此分叉，直到下一次启动才愈合。
   */
  let touchedDuringLoad = false

  function publish(next: AutomationsViewModel): void {
    snapshot = next

    for (const listener of listeners) {
      listener()
    }
  }

  function persist(automations: readonly Automation[]): void {
    const catalog: AutomationCatalog = { version: 1, automations: [...automations] }

    /*
     * 写盘失败只影响下次启动，不该把用户这次的操作打断，所以在这里终结；
     * 但不吞掉 —— 交给可观测通道。
     */
    void saveAutomations(catalog).catch((cause: unknown) => {
      warn('自动化未能写入磁盘，下次启动会回到上一次成功保存的状态', {
        scope: 'automations',
        cause,
      })
    })
  }

  function commit(automations: readonly Automation[]): void {
    touchedDuringLoad = true
    publish({ automations, loaded: true })
    persist(automations)
  }

  function replace(id: string, update: (automation: Automation) => Automation): void {
    commit(
      snapshot.automations.map((automation) =>
        automation.id === id ? update(automation) : automation,
      ),
    )
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
     * 先具名，再放进数组。
     *
     * 数组字面量后面挂着 .slice()，runs 那个属性的期望类型就到不了字面量内部：
     * TS 先独立推导数组，三元的 'failed' | 'succeeded' 被拓宽成 string，然后才
     * 拿去跟 AutomationRun[] 比 —— tsc 报错指在 runs: 上而不是 outcome: 上，
     * 说的正是这件事。标注恢复了 contextual typing，字面量收得住；而且这条
     * 记录本来就该有个名字。
     *
     * 结局记的是「这次运行有没有开起来」：对话开出来、指令经唯一的发送管线
     * 提交，就是 succeeded。指令那一轮本身的成败由那条对话自己回答 —— 运行
     * 就是一条对话，账本不存第二份运行状态。
     */
    const run: AutomationRun = {
      threadId,
      startedAt,
      outcome: threadId === null ? 'failed' : 'succeeded',
    }

    replace(automation.id, (current) => {
      const anchor = current.nextRunAt

      /*
       * 重排只有在这里才成立：日程点的火、这条仍然启用、且运行期间日程没被
       * 人动过（改过触发条件或重新启用过的人，nextRunAt 已经是新的答案）。
       * 锚点是刚刚到期的那个时刻，不是跑完的这一刻 —— 固定速率，相位不随
       * 执行时长漂移。手动试运行落在另一支：日程原样留着。
       */
      if (
        origin === 'schedule' &&
        current.enabled &&
        anchor !== null &&
        anchor === automation.nextRunAt
      ) {
        return {
          ...current,
          nextRunAt: nextOccurrence(current.trigger, Date.parse(anchor), Date.now()),
          runs: [run, ...current.runs].slice(0, RUN_HISTORY_LIMIT),
        }
      }

      return { ...current, runs: [run, ...current.runs].slice(0, RUN_HISTORY_LIMIT) }
    })
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

      commit([
        {
          id: createAutomationId(),
          title: draft.title,
          prompt: draft.prompt,
          trigger: draft.trigger,
          sessionConfig: { ...draft.sessionConfig },
          enabled: draft.trigger.kind !== 'manual',
          createdAt: new Date(now).toISOString(),
          nextRunAt: nextRunAfter(draft.trigger, now),
          runs: [],
        },
        ...snapshot.automations,
      ])
    },

    update(id, draft) {
      replace(id, (automation) => ({
        ...automation,
        title: draft.title,
        prompt: draft.prompt,
        trigger: draft.trigger,

        /*
         * 只有触发条件真的变了才重排。否则改一个错别字，interval 那条的下一次
         * 运行就被推后一整个周期 —— 人动的是提示词，不是日程。
         *
         * 停用状态下 nextRunAt 本来就是 null（见 setEnabled），照原样留着即可。
         */
        nextRunAt:
          automation.enabled && !sameTrigger(automation.trigger, draft.trigger)
            ? nextRunAfter(draft.trigger, Date.now())
            : automation.nextRunAt,
      }))
    },

    remove(id) {
      commit(snapshot.automations.filter((automation) => automation.id !== id))
    },

    setEnabled(id, enabled) {
      /*
       * 重新启用时下一次到期从此刻重新起算，不是接着那个早已过期的时刻 ——
       * 否则一停一开，人立刻挨一次补跑，那不是他按下开关时想要的。
       */
      replace(id, (automation) => ({
        ...automation,
        enabled,
        nextRunAt: enabled ? nextRunAfter(automation.trigger, Date.now()) : null,
      }))
    },

    runNow(id) {
      const automation = snapshot.automations.find((candidate) => candidate.id === id)

      if (automation !== undefined) {
        void fire(automation, 'manual')
      }
    },

    start(next) {
      dispatch = next
      touchedDuringLoad = false

      void loadAutomations()
        .then((catalog) => {
          /* 加载在飞期间人动过列表：内存这份更新，旧的那份不能盖上来。 */
          if (!touchedDuringLoad) {
            publish({ automations: catalog.automations, loaded: true })
          }

          check()
        })
        .catch((cause: unknown) => {
          warn('自动化列表读取失败', { scope: 'automations', cause })
          publish({ automations: [], loaded: true })
        })

      const timer = setInterval(check, TICK)

      return () => {
        clearInterval(timer)
        dispatch = null
      }
    },
  }
}
