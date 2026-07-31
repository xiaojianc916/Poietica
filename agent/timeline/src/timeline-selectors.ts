import type {
  PermissionItem,
  TimelineItem,
  TimelineItemId,
  TimelineState,
} from '@poietica/agent-timeline'

/**
 * Read models for the activity feed.
 *
 * 派生是增量的，不是每帧重算的。
 *
 * reducer 只有两个写入点（timeline-reducer.ts 的 push 与 draft.items[position]
 * = …），两者都是追加或就地替换，所以相邻两帧的 items 共享一段前缀，且共享的
 * 那一段里每一项都是同一个对象。派生因此只需要从第一处引用不同的地方往后重算。
 *
 * 此前这里是反过来的：buildFeedRows 每帧 filter + map 整条 items，buildTurns
 * 每帧重建全部轮次，然后由六张 WeakMap 与一个 stable() 在事后判断「其实没变」。
 * 那些表挡住的是下游的重渲染，挡不住上游的重算 —— 而重算是 O(N)/帧，N 是这条
 * 对话的长度，帧率是模型吐字的速度。文件里三处注释互相解释「这一层盖不住那一
 * 层」，那是补丁叠补丁的自证，不是设计。
 *
 * 换成变更驱动之后，剩下两张身份表（ROWS、TURN_OF）与两张投影表。投影按
 * items[0] / rows[0] 弱引用：一条对话每一帧的首项都是同一个对象，所以键天然
 * 按对话隔离，也随对话一起回收。
 */

export interface FeedRow {
  readonly item: TimelineItem
  /** The tail entry of a live run: the only row allowed to grow in place. */
  readonly isStreamingTail: boolean
}

/** 空态交出同一个数组：下游按引用判等。 */
const NO_ROWS: readonly FeedRow[] = []
const NO_TURNS: readonly ConversationTurn[] = []

/*
 * 一行的身份，和它描述的那一条一样长寿。
 *
 * reducer 每帧只换掉被这一帧碰过的那一条，所以把行记在条目上，就把「尾巴长了
 * 一点」变成一行改变，而不是一整份新转录。
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

/** 两个数组从头开始有多少项是同一个对象。指针比较，不分配。 */
function sharedPrefix(before: readonly object[], after: readonly object[]): number {
  const limit = Math.min(before.length, after.length)
  let index = 0

  while (index < limit && before[index] === after[index]) {
    index += 1
  }

  return index
}

interface FeedProjection {
  readonly items: readonly TimelineItem[]
  /** items 下标 → 行下标；-1 表示这一条不上屏。行与条目不一一对应。 */
  readonly rowOf: readonly number[]
  readonly rows: readonly FeedRow[]
  readonly live: boolean
}

const FEEDS = new WeakMap<TimelineItem, FeedProjection>()

/** 共享前缀能留下多少行：前缀里最后一条上屏条目的行号加一。 */
function keptRows(held: FeedProjection, shared: number): number {
  for (let index = shared - 1; index >= 0; index -= 1) {
    const at = held.rowOf[index] ?? -1

    if (at >= 0) {
      return at + 1
    }
  }

  return 0
}

/** 沿用共享前缀那一段，只把它之后的条目投影成行。 */
function projectRows(
  held: FeedProjection | undefined,
  items: readonly TimelineItem[],
  shared: number,
): { rowOf: number[]; rows: FeedRow[] } {
  const rowOf: number[] = held === undefined ? [] : held.rowOf.slice(0, shared)
  const rows: FeedRow[] = held === undefined ? [] : held.rows.slice(0, keptRows(held, shared))

  for (let index = shared; index < items.length; index += 1) {
    const item = items[index]

    if (item === undefined || !isRenderable(item)) {
      rowOf.push(-1)
      continue
    }

    rowOf.push(rows.length)
    rows.push(toRow(item, false))
  }

  return { rowOf, rows }
}

/** 会长大的只有末尾那一条，而且只在一轮还在跑的时候。 */
function growTail(rows: FeedRow[], live: boolean): void {
  const last = rows.length - 1
  const tail = rows[last]

  if (tail !== undefined) {
    rows[last] = toRow(tail.item, live && isGrowable(tail.item))
  }
}

/**
 * 这一帧的内容与上一帧逐字相同吗。
 *
 * 常数时间：共享前缀覆盖了全部条目、行数又相同，那么唯一可能换过的就是尾行。
 * 此前这件事的做法是「先全量重建，再逐项比较，命中就把刚建的整份丢掉」。
 */
function isSettled(
  held: FeedProjection,
  items: readonly TimelineItem[],
  shared: number,
  rows: readonly FeedRow[],
): boolean {
  if (shared !== items.length || shared !== held.items.length) {
    return false
  }

  if (rows.length !== held.rows.length) {
    return false
  }

  const last = rows.length - 1

  return last < 0 || rows[last] === held.rows[last]
}

export function selectFeedRows(state: TimelineState): readonly FeedRow[] {
  const items = state.items
  const anchor = items[0]

  if (anchor === undefined) {
    return NO_ROWS
  }

  const live = state.status === 'running' || state.status === 'awaiting_permission'
  const held = FEEDS.get(anchor)

  if (held !== undefined && held.items === items && held.live === live) {
    return held.rows
  }

  const shared = held === undefined ? 0 : sharedPrefix(held.items, items)
  const { rowOf, rows } = projectRows(held, items, shared)

  growTail(rows, live)

  /* 内容没变就交还上一份数组：下游按引用判等。 */
  const settled = held !== undefined && isSettled(held, items, shared, rows) ? held.rows : rows

  FEEDS.set(anchor, { items, rowOf, rows: settled, live })

  return settled
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
   * Absent while the turn has not yet received a reply. Capped at 300
   * characters — the card never renders more than three lines.
   */
  readonly reply?: string
}

/** 一次收集的产物：提出这一轮的那一行，加上它的位置与标题。 */
interface StagedTurn {
  readonly row: FeedRow
  readonly id: TimelineItemId
  readonly rowIndex: number
  readonly label: string
}

/*
 * 一轮的身份，和提出它的那一行一样长寿。
 *
 * 复用条件只看 rowIndex 与 reply：id 与 label 都是这一行自己的函数，而行就是
 * 键 —— 键相同它们不可能不同，比较它们只是自我安慰。
 */
const TURN_OF = new WeakMap<FeedRow, ConversationTurn>()

function toTurn(entry: StagedTurn, reply: string | undefined): ConversationTurn {
  const held = TURN_OF.get(entry.row)

  if (held !== undefined && held.rowIndex === entry.rowIndex && held.reply === reply) {
    return held
  }

  /*
   * exactOptionalPropertyTypes 打开时，reply?: string 不接受显式的 undefined，
   * 所以按有无分两支构造。
   */
  const turn: ConversationTurn =
    reply === undefined
      ? { id: entry.id, label: entry.label, rowIndex: entry.rowIndex }
      : { id: entry.id, label: entry.label, reply, rowIndex: entry.rowIndex }

  TURN_OF.set(entry.row, turn)

  return turn
}

interface TurnProjection {
  readonly rows: readonly FeedRow[]
  readonly turns: readonly ConversationTurn[]
}

const TURNS = new WeakMap<FeedRow, TurnProjection>()

export function selectTurns(rows: readonly FeedRow[]): readonly ConversationTurn[] {
  const anchor = rows[0]

  if (anchor === undefined) {
    return NO_TURNS
  }

  const held = TURNS.get(anchor)

  if (held !== undefined && held.rows === rows) {
    return held.turns
  }

  const built = buildTurns(rows, held)

  TURNS.set(anchor, { rows, turns: built })

  return built
}

function buildTurns(
  rows: readonly FeedRow[],
  held: TurnProjection | undefined,
): readonly ConversationTurn[] {
  const shared = held === undefined ? 0 : sharedPrefix(held.rows, rows)

  /*
   * 一轮的预览要往后扫到下一轮为止，所以共享前缀里最后那一轮的答复仍可能被
   * 前缀之后的行改写 —— 它跟着一起重算。再往前的轮次，扫描区间整个落在共享
   * 前缀里，一个字都不会变。
   */
  let keep = 0
  let from = 0

  if (held !== undefined) {
    while (
      keep < held.turns.length &&
      (held.turns[keep + 1]?.rowIndex ?? Number.POSITIVE_INFINITY) <= shared
    ) {
      keep += 1
    }

    from = Math.min(held.turns[keep]?.rowIndex ?? shared, shared)
  }

  /* 第一趟：从重算起点开始，收下每一句人说的话和它的行号。 */
  const staged: StagedTurn[] = []

  for (let rowIndex = from; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]

    if (row !== undefined && row.item.type === 'user_message') {
      staged.push({ id: row.item.id, label: firstLine(row.item.text), row, rowIndex })
    }
  }

  /* 第二趟：每一轮向后扫到下一轮为止，取第一段有内容的答复。 */
  const rebuilt = staged.map((entry, position) => {
    const until = staged[position + 1]?.rowIndex ?? rows.length
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

  if (held === undefined) {
    return rebuilt
  }

  const built = keep === 0 ? rebuilt : [...held.turns.slice(0, keep), ...rebuilt]

  /* 缩略导航是 memo 过的：轮次没变就必须是同一个数组。 */
  return built.length === held.turns.length && sharedPrefix(held.turns, built) === built.length
    ? held.turns
    : built
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
 * At most one: the agent waits for an answer before asking anything else. 那条
 * 不变式此前只写在注释里，实现却是一次正向 find —— 于是为了找一个恒在本轮末尾
 * 的东西，每次都要走完整条已答的历史。反着走，并在本轮开头收手：走到人说的上
 * 一句话，就说明这一轮没有在等谁。
 */
export function selectPendingPermission(state: TimelineState): PermissionItem | undefined {
  const items = state.items

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]

    if (item === undefined) {
      continue
    }

    if (item.type === 'user_message') {
      return undefined
    }

    if (item.type === 'permission' && item.resolution === undefined) {
      return item
    }
  }

  return undefined
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
 * ends a run without ever sending a failure.
 *
 * One derivation owns both, so the wait and the ending cannot disagree about
 * which turn they belong to.
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
