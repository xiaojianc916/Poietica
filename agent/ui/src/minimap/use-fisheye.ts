import { useCallback } from 'react'

/* poietica:conversation-minimap-perf@v14 */

/**
 * Half-width of the pull. Beyond roughly twice this a bar is at rest.
 *
 * Kept close to a few row pitches on purpose: a falloff much wider than the
 * spacing lifts the whole rail by a similar amount, which reads as the rail
 * getting fatter rather than as a crest travelling along it.
 */
const FALLOFF_PX = 44

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
     * Bar centres, reused across frames.
     *
     * Not a cache — it is refilled every frame. It exists only so that the
     * measuring pass can finish before the writing pass begins.
     */
    const centres: number[] = []

    /* Hand the bars back to the stylesheet rather than pinning them at zero. */
    const clear = () => {
      for (const bar of bars) {
        bar.style.removeProperty(WEIGHT_VAR)
        bar.removeAttribute(AIMED_ATTR)
      }

      aimed = null
    }

    const paint = () => {
      frame = 0

      const rect = node.getBoundingClientRect()
      const inside =
        !Number.isNaN(pointerX) &&
        pointerX >= rect.left - REACH_LEFT_PX &&
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

      /*
       * First pass: read only.
       *
       * The weight drives block-size and inline-size, and the bars share one
       * flex column — so writing a weight dirties the layout of every bar
       * below it. Interleaving the two, which is what this used to do, forces
       * a synchronous layout on every iteration: N reflows per frame, every
       * frame the hand is near the rail. Separating the passes leaves exactly
       * one flush, at the getBoundingClientRect above; every offsetTop after
       * it is served from a clean layout.
       */
      let cursor = 0

      for (const bar of bars) {
        centres[cursor] = rect.top + bar.offsetTop + bar.offsetHeight / 2
        cursor += 1
      }

      centres.length = cursor

      /* Second pass: write only. Nothing below reads layout. */
      let winner: HTMLElement | null = null
      let best = AIMED_MIN_WEIGHT

      cursor = 0

      for (const bar of bars) {
        const centre = centres[cursor]

        cursor += 1

        if (centre === undefined) {
          continue
        }

        const ratio = (centre - pointerY) / FALLOFF_PX
        const weight = Math.exp(-(ratio * ratio))
        const next = weight < EPSILON ? '0' : weight.toFixed(3)

        /*
         * Only write a weight that changed.
         *
         * The falloff dies out about eight bars out, so in a long conversation
         * most of the rail is being handed the same '0' on every frame, and
         * every one of those writes invalidates that element's style for
         * nothing. Reading the inline declaration back is CSSOM, not layout —
         * it cannot force a flush.
         */
        if (bar.style.getPropertyValue(WEIGHT_VAR) !== next) {
          bar.style.setProperty(WEIGHT_VAR, next)
        }

        if (weight > best) {
          best = weight
          winner = bar
        }
      }

      /*
       * One winner, decided from the same weights the pull was drawn from.
       *
       * At most two bars change hands per frame, so touch two — not N. The
       * attribute is a selector for three rules, so each needless write is a
       * needless selector rematch.
       */
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
