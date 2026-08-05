import { useCallback } from 'react'
import { RAIL_PITCH_PX, railCentre } from './rail-groups'

/* poietica:conversation-minimap-perf@v17 */

/**
 * 高斯半宽：两个步距。三个半宽之外与静止无异，所以波峰实际覆盖上下各两三根。
 *
 * 取步距的倍数而不是另一个手调的数：波峰宽度问的本来就是「几根」，而不是
 * 「几像素」。步距改了它自动跟上，不会各自漂。
 */
const FALLOFF_PX = RAIL_PITCH_PX * 2

/**
 * Where the pull begins, counted left from the rail's own edge.
 *
 * This is the one number to turn. Larger arms the rail earlier; smaller waits
 * until the hand is nearly there. Past roughly 96 the rail starts answering to
 * pointer traffic that was never headed for it.
 */
const REACH_LEFT_PX = 28

/** Slack on the other three sides — tolerance, not a second geometry. */
const REACH_TOP_PX = 8
const REACH_BOTTOM_PX = 8
const REACH_RIGHT_PX = 16

const WEIGHT_VAR = '--cp-rail-weight'

/** The turn under the hand. The stylesheet reads this, not ':hover'. */
const AIMED_ATTR = 'data-aimed'
const AIMED_MIN_WEIGHT = 0.35

/** Below this a weight is indistinguishable from rest; write the flat 0. */
const EPSILON = 0.002

/** 参与计算的邻域半径：高斯在三个半宽之外已经低于 EPSILON。 */
const REACH_PX = FALLOFF_PX * 3

/** 一帧要处理的柱子区间，闭区间；to < from 表示空。 */
type Span = { from: number; to: number }

/** 指针是否在进入边界之内。左边是真正的边界，其余三边只是容差。 */
const inReach = (rect: DOMRect, x: number, y: number): boolean =>
  !Number.isNaN(x) &&
  x >= rect.left - REACH_LEFT_PX &&
  x <= rect.right + REACH_RIGHT_PX &&
  y >= rect.top - REACH_TOP_PX &&
  y <= rect.bottom + REACH_BOTTOM_PX

/**
 * 落点邻域。
 *
 * 中心是等差数列，所以「哪些柱子离锚点不超过 REACH_PX」是把不等式解出来，
 * 一步得到闭区间 —— 不需要二分，也不需要向两侧走。
 */
const windowAt = (anchor: number, count: number): Span => ({
  from: Math.max(0, Math.ceil((anchor - REACH_PX - RAIL_PITCH_PX / 2) / RAIL_PITCH_PX)),
  to: Math.min(count - 1, Math.floor((anchor + REACH_PX - RAIL_PITCH_PX / 2) / RAIL_PITCH_PX)),
})

/**
 * 权重写出，并选出手底下那一根。这里一个字都不读布局。
 *
 * 只写变了的那个值：读回内联声明是 CSSOM，不是布局，不会触发 flush。
 */
const applyWeights = (
  bars: HTMLCollectionOf<HTMLElement>,
  span: Span,
  anchor: number,
): HTMLElement | null => {
  let winner: HTMLElement | null = null
  let best = AIMED_MIN_WEIGHT

  for (let index = span.from; index <= span.to; index += 1) {
    const bar = bars[index]

    if (bar === undefined) {
      continue
    }

    const ratio = (railCentre(index) - anchor) / FALLOFF_PX
    const weight = Math.exp(-(ratio * ratio))
    const next = weight < EPSILON ? '0' : weight.toFixed(3)

    if (bar.style.getPropertyValue(WEIGHT_VAR) !== next) {
      bar.style.setProperty(WEIGHT_VAR, next)
    }

    if (weight > best) {
      best = weight
      winner = bar
    }
  }

  return winner
}

/**
 * Dock magnification for a vertical rail.
 *
 * Each bar is given a weight between 0 and 1 from its distance to the pointer,
 * on a gaussian falloff, and the stylesheet turns that weight into a length.
 * The weight is written to the element as a custom property rather than held
 * in state: a pointer crossing the rail would otherwise re-render the
 * transcript on every frame.
 *
 * The pointer is tracked on the window rather than on the rail, because the
 * rail is eleven pixels wide and the boundary that matters is outside it. One
 * write per animation frame no matter how many move events the platform
 * delivers, and exactly one layout read per frame — the rail's own rect.
 */
export function useFisheye(): (node: HTMLElement | null) => (() => void) | undefined {
  return useCallback((node: HTMLElement | null) => {
    if (node === null) {
      return
    }

    const view = node.ownerDocument.defaultView

    if (view === null) {
      return
    }

    /*
     * Coarse pointers and reduced motion are answered here, not only in the
     * stylesheet: an inline custom property outranks the @media rule that
     * would neutralise it. Bowing out leaves ':hover' and ':focus-visible' in
     * charge, which is why those rules are still in the stylesheet.
     */
    if (view.matchMedia('(pointer: coarse)').matches) {
      return
    }

    if (view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    /* A live collection: always current, allocates nothing, read every frame. */
    const bars = node.getElementsByClassName(
      'conversation-minimap__turn',
    ) as HTMLCollectionOf<HTMLElement>

    let frame = 0
    let pointerX = Number.NaN
    let pointerY = Number.NaN
    let engaged = false
    let aimed: HTMLElement | null = null

    /** 上一帧真正写过的区间；交还样式表时只交还写过的那些。 */
    let painted: Span = { from: 0, to: -1 }

    const unpaint = (from: number, to: number) => {
      for (let index = from; index <= to; index += 1) {
        bars[index]?.style.removeProperty(WEIGHT_VAR)
      }
    }

    /* Hand the bars back to the stylesheet rather than pinning them at zero. */
    const clear = () => {
      unpaint(painted.from, painted.to)
      painted = { from: 0, to: -1 }

      aimed?.removeAttribute(AIMED_ATTR)
      aimed = null
    }

    const paint = () => {
      frame = 0

      const rect = node.getBoundingClientRect()

      if (!inReach(rect, pointerX, pointerY)) {
        if (engaged) {
          engaged = false
          clear()
        }

        return
      }

      engaged = true

      if (bars.length === 0) {
        return
      }

      const anchor = pointerY - rect.top
      const next = windowAt(anchor, bars.length)

      /* 出了窗口的交还样式表，而且只交还上一帧写过的。 */
      if (painted.to >= painted.from) {
        unpaint(painted.from, Math.min(painted.to, next.from - 1))
        unpaint(Math.max(painted.from, next.to + 1), painted.to)
      }

      painted = next

      const winner = applyWeights(bars, next, anchor)

      if (winner !== aimed) {
        aimed?.removeAttribute(AIMED_ATTR)
        winner?.setAttribute(AIMED_ATTR, '')
        aimed = winner
      }
    }

    const schedule = () => {
      if (frame === 0) {
        frame = view.requestAnimationFrame(paint)
      }
    }

    const track = (event: PointerEvent) => {
      pointerX = event.clientX
      pointerY = event.clientY
      schedule()
    }

    const release = () => {
      pointerX = Number.NaN
      pointerY = Number.NaN
      schedule()
    }

    view.addEventListener('pointermove', track, { passive: true })
    view.addEventListener('pointerdown', track, { passive: true })
    view.addEventListener('blur', release)
    node.ownerDocument.addEventListener('pointerleave', release, { passive: true })

    return () => {
      if (frame !== 0) {
        view.cancelAnimationFrame(frame)
      }

      view.removeEventListener('pointermove', track)
      view.removeEventListener('pointerdown', track)
      view.removeEventListener('blur', release)
      node.ownerDocument.removeEventListener('pointerleave', release)
      clear()
    }
  }, [])
}
