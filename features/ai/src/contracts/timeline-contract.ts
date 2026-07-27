import type {
  AcpPlanEntry,
  AcpToolCallContent,
  AcpToolCallId,
  AcpToolCallLocation,
  AcpToolCallStatus,
  AcpToolKind,
} from './acp-session-contract'
import type { PermissionOption, RunId, RunStatus } from './run-contract'

/**
 * The timeline projection.
 *
 * One flat, ordered list of typed entries. A tool call is a first-class entry
 * with its own identity and lifecycle, not a part buried inside a message:
 * tool_call_update addresses it by id, so it must be addressable by id here too.
 */

export type TimelineItemId = string

export interface UserMessageItem {
  readonly type: 'user_message'
  readonly id: TimelineItemId
  readonly at: number
  readonly text: string
}

export interface AgentTextItem {
  readonly type: 'agent_text'
  readonly id: TimelineItemId
  readonly at: number
  readonly text: string
  /** Sealed entries never receive further chunks. */
  readonly sealed: boolean
}

export interface AgentThoughtItem {
  readonly type: 'agent_thought'
  readonly id: TimelineItemId
  readonly at: number
  readonly text: string
  readonly sealed: boolean
  /**
   * When the chain was sealed, so how long it took is a recorded fact rather
   * than something the view times for itself. A chain still arriving has no end
   * time, exactly as a tool call still running has none.
   */
  readonly endedAt?: number
}

export interface ToolCallTimelineItem {
  readonly type: 'tool_call'
  readonly id: TimelineItemId
  readonly at: number
  readonly toolCallId: AcpToolCallId
  readonly title: string
  readonly kind: AcpToolKind
  readonly status: AcpToolCallStatus
  readonly content: readonly AcpToolCallContent[]
  readonly locations: readonly AcpToolCallLocation[]
  readonly rawInput?: unknown
  readonly rawOutput?: unknown
  readonly startedAt: number
  readonly endedAt?: number
}

export interface PlanItem {
  readonly type: 'plan'
  readonly id: TimelineItemId
  readonly at: number
  readonly entries: readonly AcpPlanEntry[]
}

export interface PermissionItem {
  readonly type: 'permission'
  readonly id: TimelineItemId
  readonly at: number
  readonly requestId: string
  readonly title: string
  readonly options: readonly PermissionOption[]
  readonly resolution?: { readonly optionId: string; readonly outcome: 'selected' | 'cancelled' }
}

export interface ErrorItem {
  readonly type: 'error'
  readonly id: TimelineItemId
  readonly at: number
  readonly message: string
}

export type TimelineItem =
  | UserMessageItem
  | AgentTextItem
  | AgentThoughtItem
  | ToolCallTimelineItem
  | PlanItem
  | PermissionItem
  | ErrorItem

/**
 * The conversation, as the feed reads it.
 *
 * runId names the turn in flight; runIndex counts the turns this transcript
 * has opened. The count exists because every run numbers its frames from one,
 * so a sequence number identifies a frame only within its own turn, and entry
 * identities have to be namespaced by turn to stay unique across a whole
 * conversation.
 */
export interface TimelineState {
  readonly runId: RunId
  readonly status: RunStatus
  readonly items: readonly TimelineItem[]
  readonly lastSeq: number
  readonly appliedSeqs: ReadonlySet<number>
  readonly runIndex: number
}
