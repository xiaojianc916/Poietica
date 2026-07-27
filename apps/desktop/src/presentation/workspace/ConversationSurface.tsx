import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import { AssistantSurface } from '@poietica/features-ai/react'

import { desktopAgentModels, desktopSessionConfig } from '../../application/ai/agent-session'
import { useSharedThreads } from '../../application/ai/threads-context'

/*
 * 一格只画一条对话。
 *
 * 标签的身份由工作台保管（conversation:<threadId>），所以这里没有自己的标签条：
 * endpoint 就是这一格的会话。
 *
 * 名字是这里唯一额外接的一根线：会话的兜底标题就是“我”说的第一句，所以那句话
 * 一发出去列表就先改名（原生侧同一次 agent_prompt 也把它写成 message 来源的
 * 标题），随后刷新一次把官方标题接回来——官方标题永远压过临时的那个。
 */

export interface ConversationSurfaceProps {
  readonly session: AgentSessionPort
  readonly threadId: string
}

export function ConversationSurface({ session, threadId }: ConversationSurfaceProps) {
  const threads = useSharedThreads()

  return (
    <AssistantSurface
      config={desktopSessionConfig()}
      endpoint={threadId}
      models={desktopAgentModels()}
      onUserMessage={(text) => {
        threads.nameFromMessage(threadId, text)
        void threads.refresh()
      }}
      session={session}
    />
  )
}
