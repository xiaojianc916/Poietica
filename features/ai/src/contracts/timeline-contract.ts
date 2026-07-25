import type {
  AcpContentBlock,
  AcpPlanEntry,
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
}

export interface ToolCallTimelineItem {
  readonly type: 'tool_call'
  readonly id: TimelineItemId
  readonly at: number
  readonly toolCallId: AcpToolCallId
  readonly title: string
  readonly kind: AcpToolKind
  readonly status: AcpToolCallStatus
  readonly content: readonly AcpContentBlock[]
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

export interface TimelineState {
  readonly runId: RunId
  readonly status: RunStatus
  readonly items: readonly TimelineItem[]
  readonly lastSeq: number
  readonly appliedSeqs: ReadonlySet<number>
}
