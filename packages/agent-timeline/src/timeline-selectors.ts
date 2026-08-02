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
  /**
   * 这一条属于此刻还在跑的那一轮。
   *
   * 工具卡片据此决定纺锤转不转。status 装的是协议值，也就是 agent 说过的话，
   * 而 ACP 只有 pending/in_progress/completed/failed 四档 ——「这次调用还在不
   * 在跑」它根本表达不了，那是这一层从轮次状态推出来的。
   *
   * 按轮次划，不是按整条对话划：上一轮留下的没有结局的调用，不会因为下一轮
   * 开始跑而重新转起来。
   *
   * 只有工具调用这一行会是 true。别的条目不读这一格，就不该因为它换身份 ——
   * 行的身份是 TimelineRow 的 memo 判据，一轮结束时把整轮的行全换一遍，等于
   * 白重渲染一整轮，其中包括每一段 Prose。turn-identity.test.ts 守着这条。
   */
  readonly isInFlight: boolean
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

function toRow(item: TimelineItem, isStreamingTail: boolean, isInFlight: boolean): FeedRow {
  const held = ROWS.get(item)

  if (
    held !== undefined &&
    held.isStreamingTail === isStreamingTail &&
    held.isInFlight === isInFlight
  ) {
    return held
  }

  const row: FeedRow = { item, isStreamingTail, isInFlight }

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
  /** 当前这一轮从哪一条开始。它之前的条目一律不在飞。 */
  readonly turnStart: number
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
  turnStart: number,
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
    rows.push(toRow(item, false, inFlightAt(item, index, turnStart)))
  }

  return { rowOf, rows }
}

/**
 * 这一条此刻还在飞吗。
 *
 * 只有工具调用回答得了这个问题，也只有它在读这一格。别的条目一律 false ——
 * 上一版把当前轮次的每一行都标了，于是一轮结束时那一轮所有行的身份一起翻新，
 * 而其中绝大多数根本不看这一格。行的身份是 TimelineRow 的 memo 判据，那等于
 * 白重渲染一整轮。turn-identity.test.ts 当场把它抓了出来。
 *
 * 类型判断同时消掉了另一处错：index >= turnStart 是闭区间，而 turnStart 正是
 * 提问那一条自己的下标 —— 一个用户消息「还在飞」本来就不成立。
 */
function inFlightAt(item: TimelineItem, index: number, turnStart: number): boolean {
  return item.type === 'tool_call' && index >= turnStart
}

/** 会长大的只有末尾那一条，而且只在一轮还在跑的时候。 */
function growTail(rows: FeedRow[], live: boolean): void {
  const last = rows.length - 1
  const tail = rows[last]

  if (tail !== undefined) {
    rows[last] = toRow(tail.item, live && isGrowable(tail.item), tail.isInFlight)
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

/**
 * 当前这一轮从哪一条开始：人说的最后一句话。
 *
 * 反着走，与 selectPendingPermission 同一套办法：代价是这一轮的长度，不是整条
 * 对话的长度。一条对话里没有人说过话时从头算起 —— 那种转录只可能来自回放。
 */
function turnStartOf(items: readonly TimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type === 'user_message') {
      return index
    }
  }

  return 0
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

  /* 一轮从人说的最后一句话开始。没在跑就没有人在飞，整条对话都不在。 */
  const turnStart = live ? turnStartOf(items) : items.length

  /*
   * 在飞的范围变了，共享前缀就不能一路沿用到底：那一段里的行还带着上一次的
   * isInFlight，而 growTail 只修得了尾行。回退到两次范围里更靠前的那一个，
   * 重投影的量因此以一轮为界，而不是整条对话。
   *
   * 它一轮只发生两次（开始、结束）。流式追加时范围没变，这里是 items.length，
   * 增量那条路一个字节都没改。
   */
  const boundary =
    held === undefined || (held.live === live && held.turnStart === turnStart)
      ? items.length
      : Math.min(held.turnStart, turnStart)

  const shared = held === undefined ? 0 : Math.min(sharedPrefix(held.items, items), boundary)
  const { rowOf, rows } = projectRows(held, items, shared, turnStart)

  growTail(rows, live)

  /* 内容没变就交还上一份数组：下游按引用判等。 */
  const settled = held !== undefined && isSettled(held, items, shared, rows) ? held.rows : rows

  FEEDS.set(anchor, { items, rowOf, rows: settled, live, turnStart })

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

/**
 * 一轮已经问出口，第一帧还没到。
 *
 * 转录里没有条目能表示这段空档，所以它由派生回答，交给等待指示器。
 *
 * 这里此前还回答另一件事：一轮结束却没有产出任何条目时，footer 换成一句
 * 「助手结束了这一轮，但没有返回任何内容。」。那是第二条报错通道，而它的
 * 输入只有 status 一个枚举 —— 它不知道发生了什么，是凭状态码编出来的。真正
 * 的经过（run_failed.message、run_finished.diagnostics、本地事故）早已是流里
 * 的 error 条目。一件事只留一个说法，那句猜出来的话连同 TurnOutcome /
 * TurnFooter 一起没有了。
 */
export function selectIsWaiting(state: TimelineState): boolean {
  if (state.status !== 'running' && state.status !== 'awaiting_permission') {
    return false
  }

  return lastRenderable(state.items)?.type === 'user_message'
}

function lastRenderable(function lastRenderable(items: readonly TimelineItem[]): TimelineItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]

    if (item !== undefined && isRenderable(item)) {
      return item
    }
  }

  return undefined
}
