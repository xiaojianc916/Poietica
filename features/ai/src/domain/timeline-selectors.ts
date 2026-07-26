import type { PermissionItem, TimelineItem, TimelineState } from '../contracts/timeline-contract'

/**
 * Read models for the activity feed.
 *
 * Pure derivations only. The feed renders whatever these return, in order, with
 * no filtering logic of its own, so what the user sees is always a function of
 * the event log alone.
 */

export interface FeedRow {
  readonly item: TimelineItem
  /** The tail entry of a live run: the only row allowed to grow in place. */
  readonly isStreamingTail: boolean
}

export function selectFeedRows(state: TimelineState): readonly FeedRow[] {
  const visible = state.items.filter(isRenderable)
  const lastIndex = visible.length - 1
  const live = state.status === 'running' || state.status === 'awaiting_permission'

  return visible.map((item, index) => ({
    item,
    isStreamingTail: live && index === lastIndex && isGrowable(item),
  }))
}

export function selectActiveToolCalls(state: TimelineState): readonly TimelineItem[] {
  return state.items.filter(
    (item) =>
      item.type === 'tool_call' && (item.status === 'pending' || item.status === 'in_progress'),
  )
}

/**
 * The question the run is currently blocked on, if any.
 *
 * At most one: the agent waits for an answer before asking anything else.
 */
export function selectPendingPermission(state: TimelineState): PermissionItem | undefined {
  return state.items.find(
    (item): item is PermissionItem => item.type === 'permission' && item.resolution === undefined,
  )
}

export function selectIsBusy(state: TimelineState): boolean {
  return state.status === 'running' || state.status === 'awaiting_permission'
}

function isRenderable(item: TimelineItem): boolean {
  if (item.type === 'agent_text' || item.type === 'agent_thought') return item.text.length > 0
  if (item.type === 'plan') return item.entries.length > 0
  return true
}

function isGrowable(item: TimelineItem): boolean {
  return item.type === 'agent_text' || item.type === 'agent_thought'
}
