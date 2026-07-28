/**
 * ACP wire shapes (the subset Poietica consumes).
 *
 * These mirror the Agent Client Protocol session/update notification. They are a
 * transcription of the protocol, not a product model: do not add product fields
 * here. Product concepts belong in timeline-contract.ts.
 */

export type AcpSessionId = string
export type AcpToolCallId = string

/** Protocol-defined tool-call lifecycle. Do not rename these values. */
export type AcpToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export type AcpToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other'

export type AcpContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string; readonly data: string }
  | { readonly type: 'resource_link'; readonly uri: string; readonly name?: string }
  | { readonly type: 'resource'; readonly uri: string; readonly text?: string }

/**
 * What a tool call produces.
 *
 * This is not a content block. The protocol wraps every payload in a tagged
 * envelope so that a diff and a live terminal can sit in the same array as
 * ordinary text, and an agent sends the envelope even for a single empty
 * string. Unwrapping it here would be a product decision disguised as a
 * transcription, so the envelope survives all the way to the renderer.
 */
export type AcpToolCallContent =
  | { readonly type: 'content'; readonly content: AcpContentBlock }
  | {
      readonly type: 'diff'
      readonly path: string
      /** Absent or null when the file is being created. */
      readonly oldText?: string | null
      readonly newText: string
    }
  | { readonly type: 'terminal'; readonly terminalId: string }

export interface AcpToolCallLocation {
  readonly path: string
  readonly line?: number
}

export type AcpPlanEntryStatus = 'pending' | 'in_progress' | 'completed'
export type AcpPlanEntryPriority = 'high' | 'medium' | 'low'

export interface AcpPlanEntry {
  readonly content: string
  readonly status: AcpPlanEntryStatus
  readonly priority: AcpPlanEntryPriority
}

/**
 * A command the agent offers for this session.
 *
 * The agent decides what these are and may revise the list mid-session, so the
 * set is never assumed and never cached across sessions. `input` is present
 * only for commands that take an argument, and the hint is display text rather
 * than a grammar.
 */
export interface AcpAvailableCommand {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string }
}

export type AcpSessionUpdate =
  | { readonly sessionUpdate: 'user_message_chunk'; readonly content: AcpContentBlock }
  | { readonly sessionUpdate: 'agent_message_chunk'; readonly content: AcpContentBlock }
  | { readonly sessionUpdate: 'agent_thought_chunk'; readonly content: AcpContentBlock }
  | {
      readonly sessionUpdate: 'tool_call'
      readonly toolCallId: AcpToolCallId
      readonly title: string
      readonly kind: AcpToolKind
      readonly status: AcpToolCallStatus
      readonly content?: readonly AcpToolCallContent[]
      readonly locations?: readonly AcpToolCallLocation[]
      readonly rawInput?: unknown
    }
  | {
      readonly sessionUpdate: 'tool_call_update'
      readonly toolCallId: AcpToolCallId
      readonly title?: string
      readonly kind?: AcpToolKind
      readonly status?: AcpToolCallStatus
      readonly content?: readonly AcpToolCallContent[]
      readonly locations?: readonly AcpToolCallLocation[]
      readonly rawOutput?: unknown
    }
  | {
      /** The protocol replaces the whole plan on every update. Never merge entries. */
      readonly sessionUpdate: 'plan'
      readonly entries: readonly AcpPlanEntry[]
    }
  | { readonly sessionUpdate: 'current_mode_update'; readonly currentModeId: string }
  | {
      /** The agent's current command list, replacing any earlier one entirely. */
      readonly sessionUpdate: 'available_commands_update'
      readonly availableCommands: readonly AcpAvailableCommand[]
    }

export interface AcpSessionNotification {
  readonly sessionId: AcpSessionId
  readonly update: AcpSessionUpdate
}

/** Reason a prompt turn ended, as reported by the agent. */
export type AcpStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled'
