import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import { AssistantSurface } from '@poietica/features-ai/react'

import { desktopAgentModels, desktopSessionConfig } from '../../application/ai/agent-session'

/*
 * 一格只画一条对话。
 *
 * 标签的身份由工作台保管（conversation:<threadId>），所以这里不需要任何自己的
 * 标签条：endpoint 就是这一格的会话。
 */

export interface ConversationSurfaceProps {
  readonly session: AgentSessionPort
  readonly threadId: string
}

export function ConversationSurface({ session, threadId }: ConversationSurfaceProps) {
  return (
    <AssistantSurface
      config={desktopSessionConfig()}
      endpoint={threadId}
      models={desktopAgentModels()}
      session={session}
    />
  )
}
