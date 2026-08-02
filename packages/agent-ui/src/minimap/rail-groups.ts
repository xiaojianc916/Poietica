import type { ConversationTurn } from '@poietica/agent-timeline'

/* poietica:conversation-minimap-density@v23 */

/**
 * 轨道上的一格。
 *
 * 它不是轮次 —— 轮次是时间线的事实,这是把事实映射到有限像素之后的结果。两者
 * 分开命名,是为了让"一格代表多轮"成为类型上说得出口的事,而不是靠约定。
 */
export type RailItem =
  | {
      readonly kind: 'turn'
      readonly id: string
      readonly rowIndex: number
      readonly ordinal: number
      readonly label: string
      readonly reply?: string
    }
  | {
      readonly kind: 'cluster'
      readonly id: string
      readonly rowIndex: number
      /** 1 起的闭区间,播报用。 */
      readonly from: number
      readonly to: number
      readonly label: string
      readonly reply?: string
    }

/**
 * 焦点窗口的上下限。
 *
 * 这两个数必须跟着 RAIL_SLOTS_MIN 走,不是独立可调的口味。窗口原本是 7–24:
 * 总格数还有五六十的时候那没问题,而现在总数被钉在 8–10 —— 取 7 就意味着八
 * 个格子里七个归焦点,远近上下文一格不剩,layout() 每一档都装不下,于是每次
 * 都跌进 packEven 均匀切。focus+context 会名存实亡,而且没有任何报错。
 *
 * 一半给焦点、一半给上下文:8 根 → 4+4,10 根 → 5+5。
 */
const MIN_FOCUS = 3
const MAX_FOCUS = 5

/** 距焦点这么多轮之内,保持最细一档。 */
const SPREAD_TURNS = 6

/** 最粗一档:2^8 = 256 轮并成一格。再粗就没有意义了。 */
const MAX_LEVEL = 8

function replyOf(turn: ConversationTurn): { readonly reply?: string } {
  return turn.reply === undefined ? {} : { reply: turn.reply }
}

/** 单格就是一轮。ordinal 是整场对话里的序号,不是段内序号。 */
function one(turn: ConversationTurn, index: number): RailItem {
  return {
    kind: 'turn',
    id: turn.id,
    rowIndex: turn.rowIndex,
    ordinal: index + 1,
    label: turn.label,
    ...replyOf(turn),
  }
}

/**
 * 把 [from, to) 这一段收成一格。
 *
 * 段首代表整段:它的 rowIndex 是这一段的入口,点它落在段首而不是段中,符合
 * "跳到某一段"的意图。只有一轮时退化成单格,不套 cluster 的壳 —— 播报"第 7–7
 * 轮"是在说废话。
 */
function fold(turns: readonly ConversationTurn[], from: number, to: number, out: RailItem[]): void {
  const head = turns[from]

  if (head === undefined) {
    return
  }

  if (to - from <= 1) {
    out.push(one(head, from))

    return
  }

  out.push({
    kind: 'cluster',
    id: head.id,
    rowIndex: head.rowIndex,
    from: from + 1,
    to,
    label: head.label,
    ...replyOf(head),
  })
}

/**
 * 没有焦点时的退路:均匀切。
 *
 * 保留它有两个用处。一是还没有阅读位置的那一瞬间 —— 那时没有"近处"可言,再
 * 分优先级就是编的。二是网格排布在极端预算下装不下时的兜底:均匀切的格数有
 * 上界保证,网格排布没有。
 */
function packEven(turns: readonly ConversationTurn[], slots: number, out: RailItem[]): void {
  const size = Math.max(1, Math.ceil(turns.length / slots))

  for (let index = 0; index < turns.length; index += size) {
    fold(turns, index, Math.min(index + size, turns.length), out)
  }
}

/**
 * 离焦点这么远的地方,一格该装多少轮。
 *
 * 二的幂,不是任意整数 —— 这一条是整个网格能站住的原因。宽度为 2^k 的桶,起点
 * 必然是 2^k 的倍数,所以焦点挪动时桶只会在那几条固定的网格线上合并或分裂,
 * 而不会整体平移。原先按 ceil(段长 / 格数) 均匀切,焦点每挪一轮,远处每一条
 * 边界都跟着挪一点:你刚记住"第 40 轮大概在那个高度",下一帧就不作数了。
 *
 * 增长是几何的,不是线性的:近处 1 轮一格,再远 2、4、8……这才是 focus+context
 * 该有的衰减。原先"窗口内全 1、窗口外全 N"是个断崖。
 */
function widthAt(distance: number, base: number): number {
  if (distance <= 0) {
    return 2 ** Math.min(base, MAX_LEVEL)
  }

  const grown = base + Math.floor(Math.log2(1 + distance / SPREAD_TURNS))

  return 2 ** Math.min(grown, MAX_LEVEL)
}

/**
 * 排一次布局:焦点前、焦点窗口、焦点后。
 *
 * base 是整体粗细档位。一次排不下就整体升一档重排 —— 与其去调各段的配额,
 * 不如平移整条衰减曲线:配额法会让某一段被压得特别狠,而这里各处按同一个比例
 * 变粗,读起来仍然是一条连续的衰减。
 *
 * 边界 clamp 到 index + 1,保证每轮循环至少前进一格 —— 升档时 snap 回去的网格
 * 线可能落在 index 之前,没有这条护栏就是死循环。
 */
function layout(
  turns: readonly ConversationTurn[],
  start: number,
  stop: number,
  base: number,
): RailItem[] {
  const items: RailItem[] = []
  let index = 0

  while (index < start) {
    const width = widthAt(start - index, base)
    const edge = Math.floor(index / width) * width + width
    const next = Math.min(Math.max(edge, index + 1), start)

    fold(turns, index, next, items)
    index = next
  }

  for (let cursor = start; cursor < stop; cursor += 1) {
    const turn = turns[cursor]

    if (turn !== undefined) {
      items.push(one(turn, cursor))
    }
  }

  index = stop

  while (index < turns.length) {
    const width = widthAt(index - stop + 1, base)
    const edge = Math.floor(index / width) * width + width
    const next = Math.min(Math.max(edge, index + 1), turns.length)

    fold(turns, index, next, items)
    index = next
  }

  return items
}

/**
 * 装不下就并格 —— 但焦点那一轮永远不并,而且远处的地标不许动。
 *
 * rowIndex 严格递增是构造保证的:三段按先后拼接,段内也按先后。turnIndexAtRow
 * 的二分依赖这一点,不能破坏。
 */
export function groupTurns(
  turns: readonly ConversationTurn[],
  capacity: number,
  activeIndex = -1,
): readonly RailItem[] {
  if (turns.length === 0) {
    return []
  }

  if (!Number.isFinite(capacity) || turns.length <= capacity) {
    return turns.map((turn, index) => one(turn, index))
  }

  const slots = Math.max(1, Math.floor(capacity))
  const even: RailItem[] = []

  if (activeIndex < 0 || activeIndex >= turns.length) {
    packEven(turns, slots, even)

    return even
  }

  const wanted = Math.max(MIN_FOCUS, Math.min(MAX_FOCUS, Math.floor(slots / 2)))
  const focus = Math.min(turns.length, slots, wanted)
  const half = Math.floor((focus - 1) / 2)
  const start = Math.min(Math.max(0, activeIndex - half), turns.length - focus)

  for (let base = 0; base <= MAX_LEVEL; base += 1) {
    const items = layout(turns, start, start + focus, base)

    if (items.length <= slots) {
      return items
    }
  }

  packEven(turns, slots, even)

  return even
}
