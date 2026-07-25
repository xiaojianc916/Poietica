import type { AgentId } from './agent-contract'

export type AssistantMessageId = string
export type AssistantRole = 'user' | 'assistant' | 'system'

export type AssistantMessagePart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | {
      readonly type: 'tool-call'
      readonly toolName: string
      readonly state: 'pending' | 'running' | 'done' | 'failed'
      readonly input?: unknown
      readonly output?: unknown
    }

export interface AssistantMessage {
  readonly id: AssistantMessageId
  readonly role: AssistantRole
  readonly parts: readonly AssistantMessagePart[]
  readonly agentId?: AgentId
  readonly createdAt: number
}

export type AssistantStatus = 'idle' | 'submitted' | 'streaming' | 'error'

export interface AssistantConversationViewModel {
  readonly messages: readonly AssistantMessage[]
  readonly status: AssistantStatus
  readonly error?: string
}
