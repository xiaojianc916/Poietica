/* poietica:conversation-minimap-jump@v11 */

/**
 * 一行在滚动区里占据的纵向区间。
 *
 * 刻意只要这三个字段：虚拟器给出的条目结构上满足它，而测试不需要为了
 * 造一个条目去认识虚拟器。类型窄到只剩判据用得到的部分，判据才可能是纯的。
 */
export interface RowSpan {
  readonly index: number
  readonly start: number
  readonly end: number
}

/**
 * 视线落在哪一行。
 *
 * 判据不是"视口顶端那一行"。顶端是一条边，上一轮的最后一行残留一个像素
 * 就会把它算成当前行；而人读到哪里，与那条边无关。取视口上方三分之一处
 * 的一点作为视线锚点 —— 文档大纲类界面通行的做法 —— 越界时机才与阅读
 * 感知一致。
 *
 * 锚点按定义落在视口之内，所以覆盖它的那一行必然已经挂载、必然在传进来
 * 的区间表里。区间按 index 升序且首尾相接，于是这是一次二分，不是一次
 * 扫描，也不需要任何一次测量。
 *
 * 表为空时返回 null：那是"还没有内容"，不是"在第 0 行"，两者不该由同一
 * 个值表示。
 */
export function rowAtAnchor(spans: readonly RowSpan[], anchor: number): number | null {
  let low = 0
  let high = spans.length - 1
  /* 锚点落在两行的缝隙里，或落在末行之后：记住最后一个已经越过的行。 */
  let passed: number | null = null

  while (low <= high) {
    const middle = (low + high) >>> 1
    const span = spans[middle]

    if (span === undefined) {
      break
    }

    if (anchor < span.start) {
      high = middle - 1
      continue
    }

    if (anchor >= span.end) {
      passed = span.index
      low = middle + 1
      continue
    }

    return span.index
  }

  /* 锚点在首行之上时落到首行：视口顶上没有别的行了。 */
  return passed ?? spans[0]?.index ?? null
}
