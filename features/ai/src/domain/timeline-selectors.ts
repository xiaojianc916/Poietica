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

/*
 * A row keeps its identity for as long as its entry and its role do.
 *
 * The reducer replaces only the entry a frame touched, so caching the row on
 * the entry itself is what turns "the tail grew" into one changed row instead
 * of a whole new transcript for a memoised renderer to walk. Keyed weakly, so a
 * row is collected together with the entry it describes.
 */
const ROWS = new WeakMap<TimelineItem, FeedRow>()

function toRow(item: TimelineItem, isStreamingTail: boolean): FeedRow {
  const held = ROWS.get(item)

  if (held !== undefined && held.isStreamingTail === isStreamingTail) {
    return held
  }

  const row: FeedRow = { item, isStreamingTail }
  ROWS.set(item, row)

  return row
}

export function selectFeedRows(state: TimelineState): readonly FeedRow[] {
  const visible = state.items.filter(isRenderable)
  const lastIndex = visible.length - 1
  const live = state.status === 'running' || state.status === 'awaiting_permission'

  return visible.map((item, index) => toRow(item, live && index === lastIndex && isGrowable(item)))
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

/** What the end of the transcript says when it has no entry to say it with. */
export type TurnFooter = { readonly kind: 'waiting' } | ({ readonly kind: 'ended' } & TurnOutcome)

/**
 * The two ends of a turn that the entries alone cannot show.
 *
 * A live run whose transcript still ends on the question is the gap before the
 * first frame of the answer. A finished run in the same shape produced nothing
 * of its own — an agent may end its turn having said nothing, and a refusal
 * ends a run without ever sending a failure — which on screen is
 * indistinguishable from a transport that lost the answer.
 *
 * One derivation owns both, so the wait and the ending cannot disagree about
 * which turn they belong to. Nothing is invented: the status is the one the
 * reducer derived from the stop reason of the run, and the tail is found by
 * walking back rather than by filtering the log into a second array.
 */
export function selectTurnFooter(state: TimelineState): TurnFooter | null {
  if (lastRenderable(state.items)?.type !== 'user_message') {
    return null
  }

  switch (state.status) {
    case 'running':
    case 'awaiting_permission':
      return { kind: 'waiting' }
    case 'completed':
    case 'cancelled':
    case 'failed':
      return { kind: 'ended', status: state.status }
    default:
      return null
  }
}

function lastRenderable(items: readonly TimelineItem[]): TimelineItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]

    if (item !== undefined && isRenderable(item)) {
      return item
    }
  }

  return undefined
}
