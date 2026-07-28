import type { AgentSessionPort } from '@poietica/agent-protocol'
import type { WorkspaceSurfaceRenderers } from '@poietica/features-workspace/contracts'

import { AssistantPane } from './AssistantPane'

/**
 * 组合根：把 AI feature 接入 workspace 表面扩展点。
 *
 * features/workspace 只声明插槽，features/ai 只声明端口，两者互不认识；
 * 会话端口在这里注入，因此这是唯一知道两者存在的地方。
 *
 * 「这一格变成了一条对话」同样是两边的交界事实，所以也从这里传进去。
 */
export function createAssistantSurfaceRenderers(
  session: AgentSessionPort,
  onConversationStarted: (threadId: string, title: string) => void,
): WorkspaceSurfaceRenderers {
  return {
    ai: () => <AssistantPane onConversationStarted={onConversationStarted} session={session} />,
  }
}
