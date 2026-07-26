import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import { AssistantSurface } from '@poietica/features-ai/react'
import type { WorkspaceSurfaceRenderers } from '@poietica/features-workspace/contracts'

import { DEFAULT_THREAD_ID } from '../../application/ai/agent-session'

/**
 * 组合根：把 AI feature 接入 workspace 表面扩展点。
 *
 * features/workspace 只声明插槽，features/ai 只声明端口，两者互不认识；
 * 会话端口在这里注入，因此这是唯一知道两者存在的地方。
 *
 * 工厂而非常量：端口的生命周期属于应用运行时，模块加载期还没有它。
 */
export function createAssistantSurfaceRenderers(
  session: AgentSessionPort,
): WorkspaceSurfaceRenderers {
  return {
    ai: () => <AssistantSurface endpoint={DEFAULT_THREAD_ID} session={session} />,
  }
}
