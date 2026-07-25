import type { AgentId } from './agent-contract'

export type AttachmentSourceId = 'files' | 'code' | 'saved-prompt'

export interface ComposerAttachment {
  readonly id: string
  readonly name: string
  readonly kind: 'file' | 'code' | 'prompt'
  readonly sizeLabel?: string
}

export interface ComposerViewModel {
  readonly draft: string
  readonly attachments: readonly ComposerAttachment[]
  readonly activeAgentId: AgentId
  readonly canSubmit: boolean
  readonly isBusy: boolean
}

export interface ComposerCommands {
  readonly setDraft: (draft: string) => void
  readonly submit: () => void
  readonly stop: () => void
  readonly selectAgent: (agentId: AgentId) => void
  readonly attach: (source: AttachmentSourceId) => void
  readonly removeAttachment: (attachmentId: string) => void
}
