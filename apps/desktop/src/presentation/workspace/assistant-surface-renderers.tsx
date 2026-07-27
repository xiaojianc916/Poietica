import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import type { WorkspaceSurfaceRenderers } from '@poietica/features-workspace/contracts'

import { AssistantPane } from './AssistantPane'

/**
 * 组合根：把 AI feature 接入 workspace 表面扩展点。
 *
 * features/workspace 只声明插槽，features/ai 只声明端口，两者互不认识；
 * 会话端口在这里注入，因此这是唯一知道两者存在的地方。
 *
 * 具体的界面组装（标签条、当前会话）在 AssistantPane 里，这里只负责接线。
 */
export function createAssistantSurfaceRenderers(
  session: AgentSessionPort,
): WorkspaceSurfaceRenderers {
  return {
    ai: () => <AssistantPane session={session} />,
  }
}
