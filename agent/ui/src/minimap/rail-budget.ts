import { useCallback, useState } from 'react'

/* poietica:conversation-minimap-density@v17 */

/**
 * 一格的行距：命中区 11px + 间距 2px，与 conversation-minimap.css 一致。
 *
 * 写死而不是从计算样式里读回来：读回来要每次布局刷新一次,而这个数只有改
 * 样式表的人会动,让它在两处同时改是比一次同步读更小的代价。
 */
export const RAIL_PITCH_PX = 13

/**
 * 这段高度装得下几格。
 *
 * 未测量时返回 Infinity —— 意思是"还不知道",于是分桶不介入,首帧照旧一轮一
 * 格。样式表上的 max-block-size 兜住这一帧,ResizeObserver 随后给出真值。
 */
export function railCapacity(availablePx: number): number {
  if (!Number.isFinite(availablePx) || availablePx <= 0) {
    return Number.POSITIVE_INFINITY
  }

  return Math.max(1, Math.floor(availablePx / RAIL_PITCH_PX))
}

/**
 * 轨道能用多高。
 *
 * 观测的是父容器而不是轨道自己：轨道的高度是它渲染的结果,观测它就是观测自己
 * 的输出,会绕回来。父容器的高度是外部约束,是真正的自变量。
 *
 * 返回引用稳定的 ref 回调,这样调用方合并 ref 时依赖数组不会每帧失效。
 */
export function useRailBudget(): {
  readonly ref: (node: HTMLElement | null) => (() => void) | void
  readonly available: number
} {
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY)

  const ref = useCallback((node: HTMLElement | null) => {
    if (node === null) {
      return
    }

    const host = node.parentElement
    const view = node.ownerDocument.defaultView

    if (host === null || view === null) {
      return
    }

    const observer = new view.ResizeObserver((entries) => {
      const entry = entries[0]

      if (entry !== undefined) {
        setAvailable(entry.contentRect.height)
      }
    })

    observer.observe(host)
    setAvailable(host.clientHeight)

    return () => {
      observer.disconnect()
    }
  }, [])

  return { ref, available }
}
