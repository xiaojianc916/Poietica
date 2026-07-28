import { useCallback } from 'react'

/* poietica:conversation-minimap@v8 */

/**
 * Half-width of the pull. Beyond roughly twice this a bar is at rest.
 *
 * Kept close to a few row pitches on purpose: a falloff much wider than the
 * spacing lifts the whole rail by a similar amount, which reads as the rail
 * getting fatter rather than as a crest travelling along it.
 */
const FALLOFF_PX = 44

/**
 * The hit region, measured out from the rail's own box.
 *
 * The rail is eleven pixels wide. Asking the pointer to actually land on it
 * before anything happens makes the whole affordance feel dead — the pull has
 * to begin while the hand is still on its way. Left is the reach that matters,
 * because that is the side the conversation is on; the other three are just
 * enough slack that a pixel of overshoot at the ends does not drop the pull.
 */
const REACH_TOP_PX = 24
const REACH_BOTTOM_PX = 24
const REACH_RIGHT_PX = 16

/** Used when no preview card is on screen to measure against. */
const REACH_LEFT_PX = 160
const REACH_LEFT_MIN_PX = 24
const REACH_LEFT_MAX_PX = 320

const CARD_SELECTOR = '[data-conversation-card]'
const WEIGHT_VAR = '--cp-rail-weight'

/**
 * The turn under the hand.
 *
 * The stylesheet already says there is at most one aimed turn and that it wins
 * over the read one; until now that was spelled ':hover', which cannot see the
 * hit region and so lit the preview card on different terms than the pull.
 * Both now read this, written once per frame from the same weights.
 *
 * The threshold is a floor on the winning weight, not a second geometry: about
 * forty-five pixels of vertical distance. Low enough that the card is already
 * fading in while the hand is still on its way, high enough that clipping the
 * very end of the rail does not flash one.
 */
const AIMED_ATTR = 'data-aimed'
const AIMED_MIN_WEIGHT = 0.35

/** Below this a weight is indistinguishable from rest; write the flat 0. */
const EPSILON = 0.002

/**
 * How far left the pull reaches.
 *
 * The preview card's trailing edge is the honest boundary: everything between
 * it and the rail is dead space that belongs to neither, so the pull may as
 * well own it. Measured rather than assumed, because the gap moves with the
 * panel width, and clamped so a missing or absurdly placed card cannot arm the
 * rail from across the window.
 */
function leftReachOf(node: HTMLElement, rect: DOMRect): number {
  const card = node.ownerDocument.querySelector(CARD_SELECTOR)

  if (card === null) {
    return REACH_LEFT_PX
  }

  const gap = rect.left - card.getBoundingClientRect().right

  return Math.min(Math.max(gap, REACH_LEFT_MIN_PX), REACH_LEFT_MAX_PX)
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
 * The pointer is tracked on the window, not on the rail, so the pull can start
 * before the hand arrives. One write per animation frame no matter how many
 * move events the platform delivers, and the rail's box is read once per frame
 * rather than once per event. Returned as a ref callback with a cleanup, which
 * React 19 calls on unmount.
 */
export function useFisheye(): (node: HTMLElement | null) => void {
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

    let frame = 0
    let pointerX = Number.NaN
    let pointerY = Number.NaN
    let engaged = false

    /* Hand the bars back to the stylesheet rather than pinning them at zero. */
    const clear = () => {
      for (const bar of node.querySelectorAll<HTMLElement>(':scope > *')) {
        bar.style.removeProperty(WEIGHT_VAR)
        bar.removeAttribute(AIMED_ATTR)
      }
    }

    const paint = () => {
      frame = 0

      const rect = node.getBoundingClientRect()
      const inside =
        !Number.isNaN(pointerX) &&
        pointerX >= rect.left - leftReachOf(node, rect) &&
        pointerX <= rect.right + REACH_RIGHT_PX &&
        pointerY >= rect.top - REACH_TOP_PX &&
        pointerY <= rect.bottom + REACH_BOTTOM_PX

      if (!inside) {
        if (engaged) {
          engaged = false
          clear()
        }

        return
      }

      engaged = true

      /* The rail's own children, not a class name owned by another file. */
      const bars = Array.from(node.querySelectorAll<HTMLElement>(':scope > *'))
      let aimed: HTMLElement | null = null
      let best = AIMED_MIN_WEIGHT

      for (const bar of bars) {
        const center = rect.top + bar.offsetTop + bar.offsetHeight / 2
        const ratio = (center - pointerY) / FALLOFF_PX
        const weight = Math.exp(-(ratio * ratio))

        bar.style.setProperty(WEIGHT_VAR, weight < EPSILON ? '0' : weight.toFixed(3))

        if (weight > best) {
          best = weight
          aimed = bar
        }
      }

      /* One winner, decided from the same weights the pull was drawn from. */
      for (const bar of bars) {
        if (bar === aimed) {
          bar.setAttribute(AIMED_ATTR, '')
        } else {
          bar.removeAttribute(AIMED_ATTR)
        }
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
