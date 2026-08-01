import { useCallback, useEffect, useState } from 'react'

/**
 * 把一个 CSS 像素长度对齐到设备像素网格。
 *
 * 为什么需要它:CSS 像素不是设备像素。显示缩放 125% 时 1 CSS px 是 1.25 个
 * 设备像素,于是一条 1px 的边落在整数相位上是一行足墨、落在半个像素上是两行
 * 半墨 —— 同一条声明栅格化出两种边。实测:--ui-border 是 sRGB 224、背景 248,
 * 锐的那版量到 1px #e0e0e0,糊的那版量到 2px #ececec,而 248-(248-224)/2=236
 * 正是 #ececec。墨量守恒,不是两套样式。
 *
 * 为什么不用 CSS round():它对齐的是 CSS 像素网格,而这里的相位在设备网格上。
 * 本仓库的 conversation-minimap.css 已经把这条边界写清楚了。
 *
 * 为什么用 matchMedia 而不是 resize:dpr 变化不一定伴随 resize —— 窗口被拖到
 * 另一块缩放不同的屏上时尺寸可以不变。查询串匹配的是当前 dpr,dpr 一变它就
 * 不再匹配,change 因此触发;订阅随之按新值重建。这是观察 dpr 的标准做法。
 */
export function useDevicePixels(): (px: number) => number {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio)

  useEffect(() => {
    /* jsdom 没有 matchMedia。那里 dpr 恒为 1,取整是恒等变换,不订阅也正确。 */
    const query = window.matchMedia?.(`(resolution: ${String(ratio)}dppx)`)

    if (query === undefined) {
      return
    }

    const sync = () => {
      setRatio(window.devicePixelRatio)
    }

    query.addEventListener('change', sync)

    return () => {
      query.removeEventListener('change', sync)
    }
  }, [ratio])

  return useCallback((px: number) => Math.round(px * ratio) / ratio, [ratio])
}
