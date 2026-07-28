import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import { AssistantSurface } from '@poietica/features-ai/react'

import { desktopAgentModels, desktopSessionConfig } from '../../application/ai/agent-session'
import { useSharedThreads } from '../../application/ai/threads-context'

/*
 * 一格只画一条对话。
 *
 * 标签的身份由工作台保管（conversation:<threadId>），所以这里没有自己的标签条。
 *
 * 名字是这里唯一额外接的一根线：兜底标题就是“我”说的第一句，那句话一发出，
 * 列表立刻改名并补上这一行（原生侧同一次 agent_prompt 也会把它写成 message
 * 来源的标题），随后刷新把官方标题接回来——官方标题永远压过临时的那个。
 */

export interface ConversationSurfaceProps {
  /** 这条对话说出第一句话时，带上它当时的名字。 */
  readonly onStarted?: (threadId: string, title: string) => void
  readonly session: AgentSessionPort
  readonly threadId: string
}

export function ConversationSurface({ onStarted, session, threadId }: ConversationSurfaceProps) {
  const threads = useSharedThreads()

  return (
    <AssistantSurface
      config={desktopSessionConfig()}
      endpoint={threadId}
      models={desktopAgentModels()}
      onUserMessage={(text) => {
        threads.nameFromMessage(threadId, text)
        void threads.refresh()
        onStarted?.(threadId, threads.standInTitle(text))
      }}
      session={session}
    />
  )
}
