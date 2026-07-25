import { useChat } from '@ai-sdk/react'
import { useCallback, useMemo, useReducer } from 'react'

import { createAiSdkTransport } from '../adapters/ai-sdk-transport'
import type { AgentId, AgentRegistryPort } from '../contracts/agent-contract'
import type { ComposerCommands, ComposerViewModel } from '../contracts/composer-contract'
import type { AssistantStatus } from '../contracts/conversation-contract'
import type { AssistantTransportPort } from '../contracts/transport-contract'
import { canSubmit, composerReducer, type ComposerState } from '../domain/composer-state'
import { DEFAULT_AGENT_ID } from '../domain/agent-registry'

export interface AssistantSessionOptions {
  readonly transport: AssistantTransportPort
  readonly registry: AgentRegistryPort
  readonly initialAgentId?: AgentId
}

export interface AssistantSession {
  readonly composer: ComposerViewModel
  readonly commands: ComposerCommands
  readonly status: AssistantStatus
  readonly agents: ReturnType<AgentRegistryPort['list']>
}

/**
 * 会话编排：把 composer 纯状态与 ai-sdk 运行时绑定。
 *
 * UI 只消费 ViewModel + Commands，永远看不到 ai-sdk 类型。
 */
export function useAssistantSession({
  transport,
  registry,
  initialAgentId = DEFAULT_AGENT_ID,
}: AssistantSessionOptions): AssistantSession {
  const [state, dispatch] = useReducer(composerReducer, {
    draft: '',
    attachments: [],
    activeAgentId: initialAgentId,
  } satisfies ComposerState)

  const chatTransport = useMemo(
    () => createAiSdkTransport(transport, state.activeAgentId),
    [transport, state.activeAgentId],
  )

  const chat = useChat({ transport: chatTransport })
  const isBusy = chat.status === 'submitted' || chat.status === 'streaming'

  const submit = useCallback(() => {
    if (!canSubmit(state, isBusy)) return
    void chat.sendMessage({ text: state.draft.trim() })
    dispatch({ type: 'draft/cleared' })
  }, [chat, isBusy, state])

  return {
    agents: registry.list(),
    status: (chat.status ?? 'idle') as AssistantStatus,
    composer: {
      draft: state.draft,
      attachments: state.attachments,
      activeAgentId: state.activeAgentId,
      canSubmit: canSubmit(state, isBusy),
      isBusy,
    },
    commands: {
      setDraft: (draft) => dispatch({ type: 'draft/changed', draft }),
      submit,
      stop: () => void chat.stop(),
      selectAgent: (agentId) => dispatch({ type: 'agent/selected', agentId }),
      attach: (source) =>
        dispatch({
          type: 'attachment/added',
          attachment: { id: crypto.randomUUID(), name: source, kind: 'file' },
        }),
      removeAttachment: (attachmentId) => dispatch({ type: 'attachment/removed', attachmentId }),
    },
  }
}
