import type { AgentSessionPort } from '@poietica/features-ai/contracts'

import { DEFAULT_THREAD_ID } from '../../application/ai/agent-session'
import { ConversationSurface } from './ConversationSurface'

/*
 * AI 表面：还没有指向任何一条已有对话的那一格。
 *
 * 标签不再由这里自造 —— 已有对话由工作台开成 conversation:<threadId> 的一等
 * 标签，所以这里只剩下「新对话」这一种形态。
 */

export interface AssistantPaneProps {
  readonly session: AgentSessionPort
}

export function AssistantPane({ session }: AssistantPaneProps) {
  return <ConversationSurface session={session} threadId={DEFAULT_THREAD_ID} />
}
