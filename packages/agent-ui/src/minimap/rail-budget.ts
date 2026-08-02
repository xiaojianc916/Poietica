import { useCallback, useState } from 'react'

/* poietica:conversation-minimap-density@v19 */

/**
 * 一格的行距：命中区 12px，不留间距，与 conversation-minimap.css 一致。
 *
 * 必须是 4 的倍数。Windows 的显示缩放是 25% 的整数倍，1 CSS px 因此等于 k/4 个
 * 设备像素；步距一旦不是 4 的倍数，每一格的小数相位就逐格漂移，同样声明的横条
 * 被栅格化成深浅不同的几种。13 在 125% 下是 16.25，四格一循环 —— 那就是这一版
 * 在修的东西。12 乘任何 k/4 都是整数。
 *
 * 写死而不是从计算样式里读回来：读回来要每次布局刷新一次,而这个数只有改
 * 样式表的人会动,让它在两处同时改是比一次同步读更小的代价。
 */
export const RAIL_PITCH_PX = 12

/**
 * 轨道上下各让出多少,与样式表里的 --cp-rail-inset 是同一个数。
 *
 * 它必须出现在这里:max-block-size 会把超出的部分裁掉,所以父容器的高度不是
 * 可用高度 —— 差的正是这两倍。少减它,分桶就会算出一个装不下的格数,末尾那格
 * 被护栏静默切掉;多减它,就是又一次白白浪费像素,也就是这一版在修的毛病。
 */
export const RAIL_INSET_PX = 2

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

  const usable = availablePx - RAIL_INSET_PX * 2

  return Math.max(1, Math.floor(usable / RAIL_PITCH_PX))
}

/**
 * 轨道上该有几根杠 —— 这与「放得下几根」是两个问题。
 *
 * railCapacity 回答的是物理上限，一块 800px 高的面板能塞六十多根。但六十根竖
 * 在边上的短横不是目录，是噪声:没有哪个专业软件的导航条会这么干(Xcode 的
 * jump bar、IDEA 的 structure 都在十几项封顶),而超出十来根之后,「一眼看见
 * 全局」这个唯一的用途本身就没了 —— 再多的格子只是把眼睛的活变重。
 *
 * 所以密度另有上限,与物理上限取小:
 *
 *   常态 8 根。轮数每翻一番才准多一根,硬顶 10 根。
 *
 * 攀升是几何的,不是「多一轮就多一格」:15 轮时 8 根加并格绰绰有余,而 100 轮
 * 时多两根买回来的是一整档折叠精度。翻番这个步长与 rail-groups 的 2^k 折叠是
 * 同一套算术,不是又一个拍出来的数。
 */
export const RAIL_SLOTS_MIN = 8
export const RAIL_SLOTS_MAX = 10

/** 低于这个轮数一律最少那一档;之上每翻一番 +1。 */
const RAIL_SLOTS_BASE = 16

export function railSlots(turnCount: number, availablePx: number): number {
  const grown =
    turnCount < RAIL_SLOTS_BASE
      ? RAIL_SLOTS_MIN
      : RAIL_SLOTS_MIN + Math.floor(Math.log2(turnCount / RAIL_SLOTS_BASE))

  /* 密度上限在前,物理上限在后:矮面板仍然说了算,它只会更小。 */
  return Math.min(Math.min(grown, RAIL_SLOTS_MAX), railCapacity(availablePx))
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
