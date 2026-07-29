import type { ConversationTurn } from '@poietica/agent-timeline'

/* poietica:conversation-minimap-density@v22 */

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
 * 把一段轮次压进给定格数,按顺序推入 out。
 *
 * offset 是这一段在整场对话里的起始下标 —— 播报的是"第几轮",不是"这段里的
 * 第几个",漏掉它两侧段就会整体报错号。
 *
 * 桶首代表整桶:它的 rowIndex 是这一段的入口,点它落在段首而不是段中,符合
 * "跳到某一段"的意图。
 */
function pack(
  segment: readonly ConversationTurn[],
  offset: number,
  slots: number,
  out: RailItem[],
): void {
  if (segment.length === 0 || slots <= 0) {
    return
  }

  const size = Math.ceil(segment.length / slots)

  for (let start = 0; start < segment.length; start += size) {
    const head = segment[start]

    if (head === undefined) {
      break
    }

    const last = Math.min(start + size, segment.length) - 1

    if (last === start) {
      out.push(one(head, offset + start))

      continue
    }

    out.push({
      kind: 'cluster',
      id: head.id,
      rowIndex: head.rowIndex,
      from: offset + start + 1,
      to: offset + last + 1,
      label: head.label,
      ...replyOf(head),
    })
  }
}

/**
 * 剩下的格子怎么分给焦点两侧。
 *
 * 按轮次数按比例,但两侧只要非空就至少得一格 —— 否则往回滚的时候前文整段从
 * 轨道上消失,它就在谎报这场对话有多长。
 */
function share(
  before: number,
  after: number,
  slots: number,
): { readonly before: number; readonly after: number } {
  const heads = (before > 0 ? 1 : 0) + (after > 0 ? 1 : 0)

  if (slots <= 0 || heads === 0) {
    return { before: 0, after: 0 }
  }

  if (slots <= heads) {
    return { before: before > 0 ? 1 : 0, after: after > 0 ? 1 : 0 }
  }

  const spare = slots - heads
  const total = before + after
  const extra = total === 0 ? 0 : Math.round((before / total) * spare)
  const head = before > 0 ? 1 + extra : 0

  return { before: head, after: after > 0 ? slots - head : 0 }
}

/**
 * 装不下就并格 —— 但焦点那一轮永远不并。
 *
 * 均匀切是错的:它不看你在读哪里,于是正在读的那一轮被埋进某个桶,悬浮卡片只
 * 显示桶首的标题,焦点被自己的缩略图吃掉了。focus+context 的头一条规矩就是
 * 焦点不折叠,所以预算按到焦点的距离分:中间一段逐轮展开,两侧各自并格。
 *
 * activeIndex 落在 turns 之外(还没有焦点)时退回均匀切 —— 那时没有"近处"
 * 可言,再分优先级就是编的。
 *
 * rowIndex 仍然严格递增:三段按先后拼接,段内也按先后。turnIndexAtRow 的二分
 * 依赖这一点,它是构造保证,不是巧合。
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
  const items: RailItem[] = []

  if (activeIndex < 0 || activeIndex >= turns.length) {
    pack(turns, 0, slots, items)

    return items
  }

  const focus = Math.min(turns.length, Math.max(1, Math.floor(slots / 3)))
  const half = Math.floor((focus - 1) / 2)
  const start = Math.min(Math.max(0, activeIndex - half), turns.length - focus)
  const stop = start + focus
  const budget = share(start, turns.length - stop, Math.max(0, slots - focus))

  pack(turns.slice(0, start), 0, budget.before, items)

  for (let index = start; index < stop; index += 1) {
    const turn = turns[index]

    if (turn !== undefined) {
      items.push(one(turn, index))
    }
  }

  pack(turns.slice(stop), stop, budget.after, items)

  return items
}
