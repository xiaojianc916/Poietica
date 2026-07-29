/* poietica:conversation-minimap-jump@v11 */

/** 判据用得到的全部：一轮从哪一行开始。 */
export interface TurnAnchor {
  readonly rowIndex: number
}

/**
 * 正在读的是第几轮。
 *
 * 轮次由 buildTurns 顺序推入，rowIndex 因此严格递增 —— 这是构造保证，
 * 不是巧合，所以答案是"最后一个起点不晚于当前行的轮次"，用二分求。
 * 原先是一次不提前退出的全扫：有序数组上做线性查找，短会话看不出来，
 * 但它是个错的写法，与长度无关。
 *
 * 空数组返回 0：调用方在没有轮次时根本不挂载导航，这个分支只是让返回
 * 类型保持是 number，而不是把空态推给上层再判一次。
 */
export function turnIndexAtRow(turns: readonly TurnAnchor[], rowIndex: number): number {
  let low = 0
  let high = turns.length - 1
  let active = 0

  while (low <= high) {
    const middle = (low + high) >>> 1
    const turn = turns[middle]

    if (turn === undefined) {
      break
    }

    if (turn.rowIndex <= rowIndex) {
      active = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return active
}
