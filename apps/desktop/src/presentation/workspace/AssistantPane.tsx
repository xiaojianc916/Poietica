import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import { useCallback, useRef, useState } from 'react'

import { useSharedThreads } from '../../application/ai/threads-context'
import { ConversationSurface } from './ConversationSurface'

/*
 * AI 表面：还没有指向任何一条已有对话的那一格，也就是“新建对话”。
 *
 * 它不是一条对话，而是开一条对话的地方，所以它不预支身份。向 agent 要一个
 * session（ACP 的 session/new）发生在第一句话，不在这一格出现的时候：打开
 * 它又走开，不会在 agent 那边留下一个没人说过话的会话。
 *
 * 此前这里一挂载就去要，并在等待期间用一个占位 id 顶着。占位 id 会漏进名字、
 * 标签和 prompt，而它对应的对话并不存在。
 *
 * 说出第一句话之后这一格就不再是“新建对话”了：它当场变成那条对话，标签标题、
 * 侧边栏那一行的高亮都由工作台的同一次 openConversation 得出。
 */

export interface AssistantPaneProps {
  readonly onConversationStarted: (threadId: string, title: string) => void
  readonly session: AgentSessionPort
}

export function AssistantPane({ onConversationStarted, session }: AssistantPaneProps) {
  const threads = useSharedThreads()
  const open = threads.create
  const [threadId, setThreadId] = useState<string | null>(null)
  const opening = useRef<Promise<string | null> | null>(null)

  /*
   * 一格只开一条对话，哪怕连着说两句。
   *
   * 第二次问等的是第一次那个 promise，所以不会开出两条对话，也不会有两条
   * 都自称是这一格。
   */
  const identify = useCallback(async (): Promise<string | null> => {
    opening.current ??= open()

    const opened = await opening.current

    if (opened !== null) {
      setThreadId(opened)
    }

    return opened
  }, [open])

  return (
    <ConversationSurface
      onIdentify={identify}
      onStarted={onConversationStarted}
      session={session}
      threadId={threadId}
    />
  )
}
