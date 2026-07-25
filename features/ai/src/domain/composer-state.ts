import type { AgentId } from '../contracts/agent-contract'
import type { ComposerAttachment } from '../contracts/composer-contract'

export interface ComposerState {
  readonly draft: string
  readonly attachments: readonly ComposerAttachment[]
  readonly activeAgentId: AgentId
}

export type ComposerEvent =
  | { readonly type: 'draft/changed'; readonly draft: string }
  | { readonly type: 'draft/cleared' }
  | { readonly type: 'agent/selected'; readonly agentId: AgentId }
  | { readonly type: 'attachment/added'; readonly attachment: ComposerAttachment }
  | { readonly type: 'attachment/removed'; readonly attachmentId: string }

export function composerReducer(state: ComposerState, event: ComposerEvent): ComposerState {
  switch (event.type) {
    case 'draft/changed':
      return { ...state, draft: event.draft }
    case 'draft/cleared':
      return { ...state, draft: '', attachments: [] }
    case 'agent/selected':
      return { ...state, activeAgentId: event.agentId }
    case 'attachment/added':
      return { ...state, attachments: [...state.attachments, event.attachment] }
    case 'attachment/removed':
      return {
        ...state,
        attachments: state.attachments.filter((item) => item.id !== event.attachmentId),
      }
    default:
      return state
  }
}

export function canSubmit(state: ComposerState, isBusy: boolean): boolean {
  return !isBusy && (state.draft.trim().length > 0 || state.attachments.length > 0)
}
