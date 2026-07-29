/* poietica:conversation-minimap-audit@v15 */

/**
 * 一行在滚动内容坐标里的起点。
 *
 * 只有起点,没有终点:行是绝对定位、首尾相接、完整铺满画布的,所以起点单调
 * 递增且中间没有空隙 —— "最后一个起点不晚于锚点的行"就是覆盖锚点的那一行,
 * 终点参与不了这个判断。声明一个从不被读的必填字段,只会让实现者以为它有
 * 意义。
 *
 * 结构上与虚拟器的 VirtualItem 兼容,所以调用方直接把 getVirtualItems() 的
 * 结果传进来即可,不需要映射,也不需要跨包导入它的类型。
 */
export interface RowSpan {
  readonly index: number
  readonly start: number
}

/**
 * 锚点落在哪一行。
 *
 * 这是"人在读哪一行"的全部定义:一条视线,和它此刻穿过的那一行。不问哪一行
 * 碰到了视口上沿 —— 上沿是一条边,上一轮的残留占住它一个像素,答案就归了上
 * 一轮。
 *
 * 有序数组上取"最后一个不晚于 x 的元素",是二分。区间表由虚拟器给出,按序号
 * 升序,所以前提成立;不成立时(表为空)返回 null,而不是谎称第 0 行 —— 首帧
 * 还没有几何可读,谎称 0 会让缩略导航先亮第一轮再跳走。
 *
 * 锚点在第一行之前时归第一行:视口顶部的留白不属于任何一行,但人此刻在读的
 * 显然是紧随其后的那一行。
 */
export function rowAtAnchor(spans: readonly RowSpan[], anchor: number): number | null {
  let low = 0
  let high = spans.length - 1
  let passed: number | null = null

  while (low <= high) {
    const middle = (low + high) >> 1
    const span = spans[middle]

    if (span === undefined) {
      break
    }

    if (span.start <= anchor) {
      passed = span.index
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return passed ?? spans[0]?.index ?? null
}
