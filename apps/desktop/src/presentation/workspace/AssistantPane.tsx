import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import { useEffect, useRef, useState } from 'react'

import { DEFAULT_THREAD_ID } from '../../application/ai/agent-session'
import { useSharedThreads } from '../../application/ai/threads-context'
import { ConversationSurface } from './ConversationSurface'

/*
 * AI 表面：还没有指向任何一条已有对话的那一格，也就是“新建会话”。
 *
 * 它不是一条对话，而是开一条对话的地方：出现时就向 agent 要一个真的 session
 * （ACP 的 session/new），因此第一句话有地方可落。会话只有说过话才会进列表，
 * 所以这一步不会在侧边栏留下空记录。
 *
 * 说出第一句话之后这一格就不再是“新建会话”了：它当场变成那条对话，标签标题、
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
  const asked = useRef(false)

  useEffect(() => {
    if (asked.current) {
      return undefined
    }

    asked.current = true
    let current = true

    void open().then((opened) => {
      if (current && opened !== null) {
        setThreadId(opened)
      }
    })

    return () => {
      current = false
    }
  }, [open])

  /*
   * 会话还没开出来之前先用占位 id 渲染：两边都是空记录，界面完全一致，
   * 因此换成真 id 时没有任何可见的跳动，而输入框第一帧就能用。
   */
  return (
    <ConversationSurface
      onStarted={onConversationStarted}
      session={session}
      threadId={threadId ?? DEFAULT_THREAD_ID}
    />
  )
}
