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
