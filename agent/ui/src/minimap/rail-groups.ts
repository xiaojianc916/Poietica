import type { ConversationTurn } from '@poietica/agent-timeline'

/* poietica:conversation-minimap-density@v17 */

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

/**
 * 装不下就并格。
 *
 * 这一版按固定桶宽均匀切,因为它保证 rowIndex 仍然严格递增 —— turnIndexAtRow
 * 的二分是构造保证的,不能在这里破坏。语义分桶(工具调用簇、错误、检查点)是
 * 之后替换这个函数体的事,签名不必再动。
 *
 * 桶首代表整桶:它的 rowIndex 是这一段的入口,点它落在段首而不是段中,符合
 * "跳到某一段"的意图。
 */
export function groupTurns(
  turns: readonly ConversationTurn[],
  capacity: number,
): readonly RailItem[] {
  if (turns.length === 0) {
    return []
  }

  if (!Number.isFinite(capacity) || turns.length <= capacity) {
    return turns.map((turn, index) => ({
      kind: 'turn' as const,
      id: turn.id,
      rowIndex: turn.rowIndex,
      ordinal: index + 1,
      label: turn.label,
      ...replyOf(turn),
    }))
  }

  const buckets = Math.max(1, Math.floor(capacity))
  const size = Math.ceil(turns.length / buckets)
  const items: RailItem[] = []

  for (let start = 0; start < turns.length; start += size) {
    const head = turns[start]

    if (head === undefined) {
      break
    }

    const last = Math.min(start + size, turns.length) - 1

    if (last === start) {
      items.push({
        kind: 'turn',
        id: head.id,
        rowIndex: head.rowIndex,
        ordinal: start + 1,
        label: head.label,
        ...replyOf(head),
      })

      continue
    }

    items.push({
      kind: 'cluster',
      id: head.id,
      rowIndex: head.rowIndex,
      from: start + 1,
      to: last + 1,
      label: head.label,
      ...replyOf(head),
    })
  }

  return items
}
/**
 * 视口盖住了哪几格。
 *
 * 结构上与 feed 的 RowRange 一致,但这里自己声明一份:轨道要的是"一段行号",
 * 它不需要知道那段行号是谁量出来的。跨目录引一个类型进来,是为了省一次声明而
 * 把两层绑在一起 —— 结构类型本来就是这两层之间的胶水。
 */
export interface RailRange {
  readonly from: number
  readonly to: number
}

/** 游标在轨道上的位置与长度,单位是格。 */
export interface RailThumb {
  readonly from: number
  readonly span: number
}

/**
 * 行区间落在哪几格上。
 *
 * 一格的覆盖范围是"从它的 rowIndex 起,到下一格之前" —— 末格一直到底。第 0 格
 * 例外:它从第 0 行起算,因为开场白与页眉不属于任何一轮,而人此刻在读的显然是
 * 紧随其后那一轮。这与 rowAtAnchor 里"锚点在第一行之前时归第一行"是同一句话。
 *
 * 没有交集时返回 null,而不是返回一个零长的游标:画一个不存在的东西,比不画更
 * 难解释。
 */
export function thumbSpan(items: readonly RailItem[], range: RailRange | null): RailThumb | null {
  if (range === null || items.length === 0) {
    return null
  }

  let first = -1
  let last = -1

  for (const [index, item] of items.entries()) {
    const since = index === 0 ? 0 : item.rowIndex
    const until = items[index + 1]?.rowIndex

    if (since > range.to) {
      break
    }

    if (until !== undefined && until - 1 < range.from) {
      continue
    }

    if (first === -1) {
      first = index
    }

    last = index
  }

  if (first === -1) {
    return null
  }

  return { from: first, span: last - first + 1 }
}
