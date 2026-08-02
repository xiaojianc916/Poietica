import { useCallback } from 'react'
import { RAIL_PITCH_PX } from './rail-budget'

/* poietica:conversation-minimap-perf@v16 */

/**
 * 高斯半宽:两个步距。三个半宽之外与静止无异,所以波峰实际覆盖上下各两三根。
 *
 * 这里原本是写死的 44,而它自己的注释就写着「半宽远大于间距时整条轨道一起
 * 抬起来,读作轨道变胖了,而不是一道波峰在移动」—— 44 是 3.7 个步距,三个半宽
 * 覆盖上下各十一根,于是杠不到二十几根时全程都落在那个失败模式里。注释预言了
 * 它,选的数却正好触发它。
 *
 * 取步距的倍数而不是另一个手调的数:波峰宽度问的本来就是「几根」,而不是
 * 「几像素」。步距改了它自动跟上,不会各自漂。
 *
 * 顺带:REACH_PX 是它的三倍,一并从 132 收到 72,每帧参与计算的柱子少一半。
 */
const FALLOFF_PX = RAIL_PITCH_PX * 2

/**
 * Where the pull begins, counted left from the rail's own edge.
 *
 * This is the one number to turn. Larger arms the rail earlier — the hand is
 * still crossing the transcript when the crest appears; smaller waits until it
 * is nearly there. Past roughly 96 the rail starts answering to pointer
 * traffic that was never headed for it. The current value was arrived at by
 * hand, against the running build.
 *
 * It is written down rather than measured on purpose. The obvious landmark to
 * measure against is the preview card, but the card is positioned against its
 * own button — 'inset-inline-end: calc(100% + gutter)' — and that button's
 * width moves with the weight. The distance from card to rail is therefore
 * always just the gutter, no matter where the card appears to sit, so
 * measuring it answers a different question than the one being asked.
 */
const REACH_LEFT_PX = 28

/**
 * Slack on the other three sides.
 *
 * The entry boundary is the left one, so these are not a second geometry: they
 * are the tolerance that keeps a pixel of overshoot at the ends, or on the far
 * side of an eleven pixel rail, from dropping the pull.
 */
const REACH_TOP_PX = 8
const REACH_BOTTOM_PX = 8
const REACH_RIGHT_PX = 16

const WEIGHT_VAR = '--cp-rail-weight'

/**
 * The turn under the hand.
 *
 * The stylesheet already says there is at most one aimed turn and that it wins
 * over the read one; that used to be spelled ':hover', which cannot see the
 * entry boundary and so lit the preview card on different terms than the pull.
 * Both now read this, written once per frame from the same weights.
 */
const AIMED_ATTR = 'data-aimed'
const AIMED_MIN_WEIGHT = 0.35

/** Below this a weight is indistinguishable from rest; write the flat 0. */
const EPSILON = 0.002

/** 参与计算的邻域半径:高斯在三个半宽之外已经低于 EPSILON。 */
const REACH_PX = FALLOFF_PX * 3

/** 一帧要处理的柱子区间,闭区间;to < from 表示空。 */
type Span = { from: number; to: number }

/** 指针是否在进入边界之内。左边是真正的边界,其余三边只是容差。 */
const inReach = (rect: DOMRect, x: number, y: number): boolean =>
  !Number.isNaN(x) &&
  x >= rect.left - REACH_LEFT_PX &&
  x <= rect.right + REACH_RIGHT_PX &&
  y >= rect.top - REACH_TOP_PX &&
  y <= rect.bottom + REACH_BOTTOM_PX

/**
 * 落点与邻域,一趟读完。
 *
 * 柱子在同一个 flex 列里首尾相接,offsetTop 单调递增 —— 前提成立,所以"最后一个
 * 中心不低于指针"是二分,读 O(log N) 次布局而不是 N 次。展开条件用真实中心距,
 * 不用"每根多高"的估算:柱子被放大之后本来就不等距,估算会在放大最厉害的地方把
 * 波峰截断 —— 那是一个看得见的退化。
 */
const solveWindow = (
  anchor: number,
  count: number,
  centreOf: (index: number) => number,
  centres: number[],
): Span => {
  let low = 0
  let high = count - 1
  let nearest = 0

  while (low <= high) {
    const middle = (low + high) >> 1

    if (centreOf(middle) <= anchor) {
      nearest = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  let from = nearest

  while (from > 0 && Math.abs(centreOf(from - 1) - anchor) <= REACH_PX) {
    from -= 1
  }

  let to = nearest

  while (to < count - 1 && Math.abs(centreOf(to + 1) - anchor) <= REACH_PX) {
    to += 1
  }

  centres.length = 0

  for (let index = from; index <= to; index += 1) {
    centres[index - from] = centreOf(index)
  }

  return { from, to }
}

/**
 * 权重写出,并选出手底下那一根。这里一个字都不读布局。
 *
 * 只写变了的那个值:读回内联声明是 CSSOM,不是布局,不会触发 flush。
 */
const applyWeights = (
  bars: HTMLCollectionOf<HTMLElement>,
  span: Span,
  centres: readonly number[],
  anchor: number,
): HTMLElement | null => {
  let winner: HTMLElement | null = null
  let best = AIMED_MIN_WEIGHT

  for (let index = span.from; index <= span.to; index += 1) {
    const bar = bars[index]
    const centre = centres[index - span.from]

    if (bar === undefined || centre === undefined) {
      continue
    }

    const ratio = (centre - anchor) / FALLOFF_PX
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
 * delivers. Returned as a ref callback with a cleanup, which React 19 calls on
 * unmount.
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

    /*
     * The rail's own children, live.
     *
     * A live collection rather than a query result: it is always current, so
     * there is no invalidation policy to get wrong when turns are added, and
     * it allocates nothing — this is read on every animation frame while the
     * hand is near. The cast is honest; the rail renders buttons.
     */
    const bars = node.getElementsByClassName(
      'conversation-minimap__turn',
    ) as HTMLCollectionOf<HTMLElement>

    let frame = 0
    let pointerX = Number.NaN
    let pointerY = Number.NaN
    let engaged = false
    let aimed: HTMLElement | null = null

    /*
     * 落点邻域的中心值,一帧一填。读的一趟填,写的一趟读,中间不碰布局。
     *
     * 只装参与计算的那几根:三个半宽之外的柱子算出来的权重与静止态没有区别。
     */
    const centres: number[] = []

    /*
     * 上一帧真正写过的区间。
     *
     * 交还样式表只需要交还写出去的那些:对没写过的柱子调 removeProperty 仍然要
     * 作废一次内联声明,那是白付的代价。
     */
    let painted: Span = { from: 0, to: -1 }

    /** 一根柱子的中心,在轨道自身的坐标里。 */
    const centreOf = (index: number): number => {
      const bar = bars[index]

      return bar === undefined ? Number.NaN : bar.offsetTop + bar.offsetHeight / 2
    }

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

      /* 读的一趟:落点、邻域、中心值。 */
      const anchor = pointerY - rect.top
      const next = solveWindow(anchor, bars.length, centreOf, centres)

      /* 出了窗口的交还样式表,而且只交还上一帧写过的。 */
      if (painted.to >= painted.from) {
        unpaint(painted.from, Math.min(painted.to, next.from - 1))
        unpaint(Math.max(painted.from, next.to + 1), painted.to)
      }

      painted = next

      /* 写的一趟。至多两根柱子每帧换手,所以只碰两根,不是 N 根。 */
      const winner = applyWeights(bars, next, centres, anchor)

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
