import { createAutomationStore } from '@poietica/automations'
import type { Automation } from '@poietica/ipc'
import { CONVERSATION_ENTRY_TITLE } from '@poietica/workspace'
import { useEffect } from 'react'
import { useThreadsActions } from '../assistant/threads-context'

/**
 * 自动化的进程级运行时。
 *
 * 一个进程一份，和 agent 会话、方言、对话列表同级。
 */
export const automationStore = createAutomationStore()

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
export function AutomationScheduler() {
  const create = useThreadsActions().create

  useEffect(() => {
    const dispatch = async (automation: Automation): Promise<string | null> => {
      const threadId = await create()

      if (threadId === null) {
        return null
      }

      return threadId
    }

    return automationStore.start(dispatch)
  }, [create])

  return null
}

/* 标签标题与「新建对话」出自同一处，不另抄一份字面量。 */
export const AUTOMATION_THREAD_TITLE = CONVERSATION_ENTRY_TITLE
