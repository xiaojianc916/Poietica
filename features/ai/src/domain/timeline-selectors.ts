import type {
  PermissionItem,
  TimelineItem,
  TimelineItemId,
  TimelineState,
} from '../contracts/timeline-contract'

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

/**
 * The turns of the conversation, as the rail reads them.
 *
 * A turn opens where the user speaks: everything after a question belongs to
 * the answer to it, so the questions alone are the table of contents. The
 * position of a turn is a feed row index, because the scrollport addresses
 * rows and nothing else — no pixel is measured to build this.
 */
export interface ConversationTurn {
  readonly id: TimelineItemId
  readonly rowIndex: number
  /** The first line of the question: what the rail labels the turn with. */
  readonly label: string
}

export function selectTurns(rows: readonly FeedRow[]): readonly ConversationTurn[] {
  const turns: ConversationTurn[] = []

  rows.forEach((row, rowIndex) => {
    if (row.item.type === 'user_message') {
      turns.push({ id: row.item.id, label: firstLine(row.item.text), rowIndex })
    }
  })

  return turns
}

function firstLine(text: string): string {
  return text.trim().split('\n', 1)[0] ?? ''
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
  if (item.type === 'agent_text' || item.type === 'agent_thought') {
    return item.text.length > 0
  }
  if (item.type === 'plan') {
    return item.entries.length > 0
  }
  return true
}

function isGrowable(item: TimelineItem): boolean {
  return item.type === 'agent_text' || item.type === 'agent_thought'
}

/** How a turn ended, for a turn that ended without saying anything. */
export interface TurnOutcome {
  readonly status: 'completed' | 'cancelled' | 'failed'
}

/**
 * A finished turn that produced no entry of its own.
 *
 * Two endings are silent by nature: an agent may finish its turn having said
 * nothing, and a refusal ends a run without ever sending a failure. Both leave
 * a segment holding only the question, which on screen is indistinguishable
 * from a transport that lost the answer — so the surface states the ending
 * instead of drawing nothing.
 *
 * Nothing is invented here: the status is the one the reducer derived from the
 * stop reason of the run.
 */
export function selectSilentOutcome(state: TimelineState): TurnOutcome | null {
  const status = state.status

  if (status !== 'completed' && status !== 'cancelled' && status !== 'failed') {
    return null
  }

  const tail = state.items.filter(isRenderable).at(-1)

  if (tail === undefined || tail.type !== 'user_message') {
    return null
  }

  return { status }
}
