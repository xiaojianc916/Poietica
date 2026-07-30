import type {
  PermissionItem,
  TimelineItem,
  TimelineItemId,
  TimelineState,
} from '@poietica/agent-timeline'

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

/*
 * 一个转录状态对应一份读模型。
 *
 * reducer 每帧产出新状态，而读它的地方不止一个（流、缩略图、页脚、忙碌位），
 * 于是同一次渲染里整条转录被过滤又映射好几遍。按状态弱引用记住之后，一个状态
 * 只算一次；状态被换掉，它的读模型跟着一起回收。
 */
const FEEDS = new WeakMap<TimelineState, readonly FeedRow[]>()

export function selectFeedRows(state: TimelineState): readonly FeedRow[] {
  const held = FEEDS.get(state)

  if (held !== undefined) {
    return held
  }

  const built = buildFeedRows(state)
  FEEDS.set(state, built)

  return built
}

/*
 * 上一次算出来的那一份，按这条转录的首条弱引用。
 *
 * reducer 每帧只换掉末尾一条，于是这里 map 出来的元素几乎全是旧对象、数组本身
 * 却是新的。任何以「行数组」为键的下游记忆（selectTurns）因此必然落空。
 *
 * 逐项相同就把上一次那个数组原样还回去。这一层管的是「可见条目一个都没换」那
 * 一种帧；末尾那一行的角色变了时它照样交出新数组，那是对的 —— 行确实变了。也
 * 正因为如此，这份记忆盖不住上面那层：轮次在同一帧里没有变化，所以 selectTurns
 * 需要它自己的一份，键取首行。
 */
const LAST_ROWS = new WeakMap<TimelineItem, readonly FeedRow[]>()

function buildFeedRows(state: TimelineState): readonly FeedRow[] {
  const visible = state.items.filter(isRenderable)
  const lastIndex = visible.length - 1
  const live = state.status === 'running' || state.status === 'awaiting_permission'
  const built = visible.map((item, index) =>
    toRow(item, live && index === lastIndex && isGrowable(item)),
  )

  const anchor = visible[0]

  if (anchor === undefined) {
    return built
  }

  const held = LAST_ROWS.get(anchor)

  if (
    held !== undefined &&
    held.length === built.length &&
    held.every((row, index) => row === built[index])
  ) {
    return held
  }

  LAST_ROWS.set(anchor, built)

  return built
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
  /**
   * The opening text of the AI answer, for the preview card.
   *
   * Absent while the turn has not yet received a reply (e.g. the run is still
   * streaming the first chunk, or the turn produced no agent text at all).
   * Capped at 300 characters — the card never renders more than three lines,
   * so more would be invisible weight.
   */
  readonly reply?: string
}

/** 一次收集的产物:提出这一轮的那一行,加上它的位置与标题。 */
interface StagedTurn {
  readonly row: FeedRow
  readonly id: TimelineItemId
  readonly rowIndex: number
  readonly label: string
}

/*
 * 一轮的身份,和提出它的那一行一样长寿。
 *
 * 这是上面 toRow 的同一招,用在下一层。流式输出时 reducer 每帧换掉末尾那一条,
 * buildFeedRows 的 map 于是每帧产出一个新数组 —— 里面的元素几乎全是复用的,
 * 但数组本身是新的,而 TURNS 以数组为键,所以每帧必然落空、必然重建全部 N 个
 * 轮次对象。下游那个 memo 过的缩略导航因此在整段流式期间形同虚设。
 *
 * 复用条件只看 rowIndex 和 reply。id 与 label 都是这一行自己的函数,而行就是
 * 键 —— 键相同,它们不可能不同,比较它们只是自我安慰。
 */
const TURN_OF = new WeakMap<FeedRow, ConversationTurn>()

function toTurn(entry: StagedTurn, reply: string | undefined): ConversationTurn {
  const held = TURN_OF.get(entry.row)

  if (held !== undefined && held.rowIndex === entry.rowIndex && held.reply === reply) {
    return held
  }

  /*
   * exactOptionalPropertyTypes 打开时,reply?: string 不接受显式的 undefined,
   * 所以按有无分两支构造,而不是写成 { ..., reply } 一了百了。
   */
  const turn: ConversationTurn =
    reply === undefined
      ? { id: entry.id, label: entry.label, rowIndex: entry.rowIndex }
      : { id: entry.id, label: entry.label, reply, rowIndex: entry.rowIndex }

  TURN_OF.set(entry.row, turn)

  return turn
}

const TURNS = new WeakMap<readonly FeedRow[], readonly ConversationTurn[]>()

/*
 * 上一次算出来的那一份轮次，按这条转录的首行弱引用。
 *
 * 行与轮次的变化频率本来就不同：末尾那一行的角色一翻，buildFeedRows 就必须交出
 * 新数组 —— 行确实变了；而同一帧里提问行和它的预览一个都没动，轮次不该跟着换。
 * TURNS 以行数组为键，于是整段流式期间每帧必落空、必重建全部 N 个轮次对象，
 * 下游那个 memo 过的缩略导航因此形同虚设。下一层的引用稳定盖不住这一层。
 *
 * 键取首行而不是行数组：首行在整段流式里是同一个对象，所以这份记忆命中，而不是
 * 像以数组为键那样每帧从零开始。逐项相同就把上一次那个数组原样还回去。
 */
const LAST_TURNS = new WeakMap<FeedRow, readonly ConversationTurn[]>()

export function selectTurns(rows: readonly FeedRow[]): readonly ConversationTurn[] {
  const held = TURNS.get(rows)

  if (held !== undefined) {
    return held
  }

  const built = buildTurns(rows)
  TURNS.set(rows, built)

  return built
}

function buildTurns(rows: readonly FeedRow[]): readonly ConversationTurn[] {
  /*
   * First pass: collect every user message with its feed-row position.
   *
   * The result is a plain mutable staging array; the readonly ConversationTurn
   * objects are built in the second pass once reply text is known.
   */
  const staged: StagedTurn[] = []

  rows.forEach((row, rowIndex) => {
    if (row.item.type === 'user_message') {
      staged.push({ id: row.item.id, label: firstLine(row.item.text), row, rowIndex })
    }
  })

  /*
   * Second pass: for each turn, scan forward to the next user message (or the
   * end of the feed) and pick the first agent_text chunk that has content.
   *
   * The scan is bounded by the next turn's rowIndex, so each chunk is assigned
   * to exactly one turn and the loop is O(n) over the feed in total.
   */
  const built = staged.map((entry, turnIndex) => {
    const until = staged[turnIndex + 1]?.rowIndex ?? rows.length
    let reply: string | undefined

    for (let index = entry.rowIndex + 1; index < until; index += 1) {
      const row = rows[index]

      if (row !== undefined && row.item.type === 'agent_text' && row.item.text.length > 0) {
        reply = row.item.text.slice(0, 300)
        break
      }
    }

    return toTurn(entry, reply)
  })

  const anchor = rows[0]

  if (anchor === undefined) {
    return built
  }

  const held = LAST_TURNS.get(anchor)

  if (
    held !== undefined &&
    held.length === built.length &&
    held.every((turn, index) => turn === built[index])
  ) {
    return held
  }

  LAST_TURNS.set(anchor, built)

  return built
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
