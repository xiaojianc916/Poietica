/*
 * Presentation entry point for @hybrid-canvas/ai.
 *
 * Published deliberately narrow: the vendored AI Elements source and the
 * icon primitives are implementation details and must not become part of
 * the cross-package contract.
 */

export { AssistantComposer } from './AssistantComposer'
export type { AssistantComposerProps } from './AssistantComposer'

export { AssistantQuickActions } from './AssistantQuickActions'

export { AssistantSurface } from './AssistantSurface'
export type { AssistantSurfaceProps } from './AssistantSurface'

export type { ChatStatus, PromptInputMessage } from './ai-elements/prompt-input'
