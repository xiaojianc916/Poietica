import { DefaultChatTransport } from 'ai'

import type { AgentId } from '../contracts/agent-contract'
import type { AssistantTransportPort } from '../contracts/transport-contract'

/**
 * Vercel ai-sdk 传输适配器。
 *
 * 边界约束：本文件是整个仓库唯一直接依赖 ai-sdk 传输实现的位置。
 */
export function createAiSdkTransport(port: AssistantTransportPort, agentId: AgentId) {
  return new DefaultChatTransport({
    api: port.endpoint,
    headers: port.headers,
    body: port.buildBody?.(agentId) ?? { agentId },
  })
}
