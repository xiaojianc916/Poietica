import { useCallback, useState } from 'react'

/**
 * 轨道能用多高。
 *
 * 观测的是父容器而不是轨道自己：轨道的高度是它渲染的结果,观测它就是观测自己
 * 的输出,会绕回来。父容器的高度是外部约束,是真正的自变量。
 *
 * 返回引用稳定的 ref 回调,这样调用方合并 ref 时依赖数组不会每帧失效。
 */
export function useRailBudget(): {
  readonly ref: (node: HTMLElement | null) => (() => void) | undefined
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
