import { createAutomationStore } from '@poietica/automations'
import type { Automation } from '@poietica/ipc'
import type { WorkbenchSessionStore } from '@poietica/workspace'
import { useEffect } from 'react'

import { useThreadsActions } from '../assistant/threads-context'

/**
 * 自动化的进程级运行时。
 *
 * 一个进程一份，和 agent 会话、方言、对话列表同级（见 assistant/agent-session）。
 */
export const automationStore = createAutomationStore()

export interface AutomationSchedulerProps {
  readonly workspace: WorkbenchSessionStore
}

/**
 * 调度器的挂载点。
 *
 * 无渲染产出，只负责「让心跳活着」。它必须挂在 ThreadsProvider 之内、而且与
 * 应用同寿：挂在自动化那一格里的话，人切走标签页自动化就停摆了 —— 那正好是
 * 自动化唯一的意义所在。
 *
 * 「到期时做什么」在这里注入，不在 @poietica/automations 里：那一层不认识
 * agent，也不认识工作台。一次运行就是开出一条普通对话 —— 会话是唯一中心，
 * 自动化不另立一套执行器，也不另存一份运行日志。
 */
export function AutomationScheduler({ workspace }: AutomationSchedulerProps) {
  const threads = useThreadsActions()

  useEffect(() => {
    const dispatch = async (automation: Automation): Promise<string | null> => {
      const threadId = await threads.create()

      if (threadId === null) {
        return null
      }

      /*
       * 这条自动化要的会话设置，只下发到它自己开出来的这条对话。
       *
       * 不走 chooseAgentControl。那一个是全进程那一份（agent-capability-store
       * 的 #chosen）：它会改写 config.toml 的 default_model，会把人选的推理档位
       * 与模式一并清掉（换模型时那段 for 循环），还会让 ThreadsStore 把每一条
       * 开着的对话都对齐过去。一次后台到期改掉人正在用的模型，那是 bug。
       *
       * selectControl 点名一条对话，作用域正好就是这一次运行。它是尽力而为的：
       * agent 可以拒绝、改名或撤回某个取值，失败由会话那一侧按对话记下来
       * （selectorFailureOf），这里不替它兜底，也不假装设过。
       */
      for (const [controlId, value] of Object.entries(automation.sessionConfig)) {
        if (value !== undefined) {
          threads.selectControl(threadId, controlId, value)
        }
      }

      /*
       * 让这条对话叫自动化的名字。
       *
       * 走的是官方标题到达时的同一条路（WorkbenchSessionCommands.setConversationTitle），
       * 没有为自动化另开一条命名通道。这里不 openConversation：一次后台到期不该
       * 抢走人正在看的那一格 —— 跑完之后从「最近运行」那一列点进去，才是人自己
       * 决定要看它。
       */
      workspace.setConversationTitle(threadId, automation.title)

      return threadId
    }

    return automationStore.start(dispatch)
  }, [threads, workspace])

  return null
}
