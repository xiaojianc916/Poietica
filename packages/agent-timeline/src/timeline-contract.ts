import type {
  AcpPermissionOption,
  AcpPlanEntry,
  AcpToolCallContent,
  AcpToolCallId,
  AcpToolCallLocation,
  AcpToolCallStatus,
  AcpToolCallUpdate,
  AcpToolKind,
  RunStatus,
} from '@poietica/acp'

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
  /**
   * 这些字属于哪一条消息，由 agent 自己说（ContentChunk.messageId）。
   *
   * 与 sealed 是两件事，此前由 sealed 一个人兼着：sealed 说的是「还会不会再
   * 来字」，那是生命周期，喂的是流式动画；这里说的是「这些字属于谁」，那是
   * 身份，定的是边界。一个布尔同时表达两件事，边界就只能靠「末尾那条封没封
   * 口」去推 —— 背靠背发来的两条消息中间没有任何东西打断，于是被推成一条。
   *
   * 缺席表示这个 agent 不报身份，边界退回相邻推断。
   */
  readonly messageId?: string
  /** Sealed entries never receive further chunks. 只管生命周期。 */
  readonly sealed: boolean
}

export interface AgentThoughtItem {
  readonly type: 'agent_thought'
  readonly id: TimelineItemId
  readonly at: number
  readonly text: string
  readonly messageId?: string
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
  readonly toolCall?: AcpToolCallUpdate
  readonly options: readonly AcpPermissionOption[]
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
 * 它没有轮次号，因为它不是一轮：它是一条对话，由若干段组成。段号（runIndex）
 * 是从这段日志里数出来的，不是从外面交进来的 —— 它只用来给条目身份分命名
 * 空间，因为每一轮的帧都从一号开始编，光看 seq 分不出这是第几轮的第三帧。
 *
 * 此前这里还挂着一个 runId。它由 prompt 的答复事后补进来（transcript-store
 * 的 send），在那之前的值是字符串 'run_pending'，而从头到尾没有一个 selector
 * 或组件读过它。
 */
export interface TimelineState {
  readonly status: RunStatus
  readonly items: readonly TimelineItem[]
  /**
   * 这一段里已经收到的最大序号；零表示还没有收到任何一帧。
   *
   * 去重只需要它。序号由原生侧的 recorder 从一开始逐帧递增（recorder.rs 的
   * next_seq / saturating_add），帧走单条有序 IPC，并且在 RunSlot 的锁下顺序
   * 转发 —— 所以「到过」等价于「不大于它」。此前这里另挂一个 appliedSeqs 集合，
   * 每处理一帧整份复制一次，一轮 N 帧就是 O(N²)，而它能表达的东西并不比一个
   * 数字多。
   */
  readonly lastSeq: number
  readonly runIndex: number
}
