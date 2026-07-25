import { createAgentRegistry } from '@poietica/ai'
import type { AssistantTransportPort } from '@poietica/ai'
import { AssistantSurface } from '@poietica/ai/react'
import type { WorkspaceSurfaceRenderers } from '@poietica/workspace/contracts'

/**
 * 组合根：把 AI feature 接入 workspace 表面扩展点。
 *
 * Phase 4 会把 endpoint 换成 Tauri IPC 通道，此处是唯一改动点。
 */
const ASSISTANT_TRANSPORT: AssistantTransportPort = {
  endpoint: import.meta.env.VITE_ASSISTANT_ENDPOINT ?? '/api/assistant/chat',
}

const AGENT_REGISTRY = createAgentRegistry()

export const WORKSPACE_SURFACE_RENDERERS: WorkspaceSurfaceRenderers = {
  ai: () => <AssistantSurface registry={AGENT_REGISTRY} transport={ASSISTANT_TRANSPORT} />,
}
