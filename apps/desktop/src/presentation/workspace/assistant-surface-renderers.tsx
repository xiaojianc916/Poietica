import type { AgentSessionPort } from '@poietica/agent-protocol'
import type { WorkspaceSurfaceRenderers } from '@poietica/features-workspace/contracts'

import { AssistantPane } from './AssistantPane'

/**
 * 把 AI feature 接入 workspace 表面扩展点。
 *
 * features/workspace 只声明插槽,features/ai 只声明端口,两者互不认识;
 * 会话端口在这里注入。
 *
 * 「这一格变成了一条对话」同样是两边的交界事实,所以也从这里传进去。
 *
 * 对面那家 agent 的方言不在这里:助手界面有不止一个入口(这个插槽,以及
 * 对话被提升成标签页时的 ConversationSurface),方言落在应用根部,
 * 见 presentation/AppShell.tsx。
 */
export function createAssistantSurfaceRenderers(
  session: AgentSessionPort,
  onConversationStarted: (threadId: string, title: string) => void,
): WorkspaceSurfaceRenderers {
  return {
    ai: () => <AssistantPane onConversationStarted={onConversationStarted} session={session} />,
  }
}
