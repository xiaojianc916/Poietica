// poietica:proximity-fisheye@v4
// Proximity-based fisheye ("Dock magnification") for the conversation minimap.
//
// Design notes:
//  - Distance uses the padded rect SDF, not the element centre.
//  - The ramp is anchored to a measured layout edge (the conversation card),
//    so it always starts at the card border instead of a hardcoded pixel value.
//  - Enter and exit thresholds differ (hysteresis) to kill boundary flicker.
//  - Per-item weight is a Gaussian of the vertical pointer distance.
//  - The rAF loop writes CSS custom properties; React never re-renders on move.
//  - Options are serialized into the dependency list, so the effect re-runs
//    exactly when their values change — and never when a caller merely passes a
//    fresh object literal with identical contents. Options must be JSON-safe.
//  - Disabled for coarse pointers and prefers-reduced-motion.

import { type RefObject, useEffect } from 'react'
import {
  PFE_ACTIVE_ATTR,
  PFE_ITEM_SELECTOR,
  PFE_ROOT_ATTR,
  PFE_WEIGHT_VAR,
  PROXIMITY_FISHEYE_DEFAULTS,
  type ProximityFisheyeOptions,
} from './proximity-fisheye.constants'

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

export function useProximityFisheye(
  rootRef: RefObject<HTMLElement | null>,
  overrides: Partial<ProximityFisheyeOptions> = {},
): void {
  const optionsKey = JSON.stringify(overrides)

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof window === 'undefined') {
      return
    }
    if (window.matchMedia('(pointer: coarse)').matches) {
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    const raw = JSON.parse(optionsKey) as Partial<ProximityFisheyeOptions>
    const opts: ProximityFisheyeOptions = {
      ...PROXIMITY_FISHEYE_DEFAULTS,
      ...raw,
      hitPadding: { ...PROXIMITY_FISHEYE_DEFAULTS.hitPadding, ...(raw.hitPadding ?? {}) },
    }
    if (opts.exitDistance <= opts.enterDistance) {
      throw new Error('[proximity-fisheye] exitDistance must be greater than enterDistance')
    }
    if (opts.anchorMaxGap <= opts.anchorMinGap) {
      throw new Error('[proximity-fisheye] anchorMaxGap must be greater than anchorMinGap')
    }

    root.setAttribute(PFE_ROOT_ATTR, '')

    let items: HTMLElement[] = []
    let centers: number[] = []
    let sigma = 1
    let rect = root.getBoundingClientRect()
    let enterDistance = opts.enterDistance
    let exitDistance = opts.exitDistance
    let leftPadding = opts.hitPadding.left

    /** Resolve the ramp start from live layout, falling back to static values. */
    const measureAnchor = (): void => {
      enterDistance = opts.enterDistance
      exitDistance = opts.exitDistance
      leftPadding = opts.hitPadding.left
      if (!opts.anchorSelector) {
        return
      }
      const anchor = document.querySelector(opts.anchorSelector)
      if (!anchor) {
        return
      }
      const bounds = anchor.getBoundingClientRect()
      const rawGap = rect.left - bounds.right
      if (!Number.isFinite(rawGap) || rawGap <= 0) {
        return
      }
      const gap = clamp(rawGap, opts.anchorMinGap, opts.anchorMaxGap)
      // The rail reacts the moment the pointer crosses the card's right border.
      exitDistance = gap
      enterDistance = clamp(gap * opts.anchorEnterRatio, 16, gap - 8)
      leftPadding = 0
    }

    const measure = (): void => {
      rect = root.getBoundingClientRect()
      items = Array.from(root.querySelectorAll<HTMLElement>(PFE_ITEM_SELECTOR))
      centers = items.map((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.top + bounds.height / 2
      })
      const span = centers.length > 1 ? centers[centers.length - 1] - centers[0] : 0
      const pitch = centers.length > 1 ? span / (centers.length - 1) : Math.max(rect.height, 1)
      sigma = Math.max(pitch * opts.falloffItems, 1)
      measureAnchor()
    }

    measure()

    let pointerY = Number.NEGATIVE_INFINITY
    let target = 0
    let activation = 0
    let raf = 0
    let disposed = false

    const distanceToRect = (x: number, y: number): number => {
      const pad = opts.hitPadding
      const dx = Math.max(rect.left - leftPadding - x, 0, x - (rect.right + pad.right))
      const dy = Math.max(rect.top - pad.top - y, 0, y - (rect.bottom + pad.bottom))
      return Math.hypot(dx, dy)
    }

    const paint = (): void => {
      items.forEach((element, index) => {
        const dy = pointerY - centers[index]
        const gauss = Math.exp(-(dy * dy) / (2 * sigma * sigma))
        const value = gauss * activation
        const weight = value < opts.epsilon ? 0 : value
        element.style.setProperty(PFE_WEIGHT_VAR, weight.toFixed(4))
      })
      if (activation > opts.epsilon) {
        root.setAttribute(PFE_ACTIVE_ATTR, '')
      } else {
        root.removeAttribute(PFE_ACTIVE_ATTR)
      }
    }

    const frame = (): void => {
      raf = 0
      if (disposed) {
        return
      }
      activation += (target - activation) * opts.smoothing
      const settled = Math.abs(target - activation) < opts.epsilon
      if (settled) {
        activation = target
      }
      paint()
      if (!settled) {
        raf = requestAnimationFrame(frame)
      }
    }

    const schedule = (): void => {
      if (raf === 0 && !disposed) {
        raf = requestAnimationFrame(frame)
      }
    }

    const onPointerMove = (event: PointerEvent): void => {
      pointerY = event.clientY
      const distance = distanceToRect(event.clientX, event.clientY)
      const ramp = (exitDistance - distance) / Math.max(exitDistance - enterDistance, 1)
      target = clamp(ramp, 0, 1)
      schedule()
    }

    const onPointerOut = (): void => {
      target = 0
      schedule()
    }

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(root)
    if (opts.anchorSelector) {
      const anchor = document.querySelector(opts.anchorSelector)
      if (anchor) {
        resizeObserver.observe(anchor)
      }
    }
    const mutationObserver = new MutationObserver(measure)
    mutationObserver.observe(root, { childList: true, subtree: true })

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('resize', measure, { passive: true })
    window.addEventListener('scroll', measure, { passive: true, capture: true })
    window.addEventListener('blur', onPointerOut)
    document.addEventListener('pointerleave', onPointerOut)

    return () => {
      disposed = true
      if (raf !== 0) {
        cancelAnimationFrame(raf)
      }
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('blur', onPointerOut)
      document.removeEventListener('pointerleave', onPointerOut)
      items.forEach((element) => {
        element.style.removeProperty(PFE_WEIGHT_VAR)
      })
      root.removeAttribute(PFE_ACTIVE_ATTR)
      root.removeAttribute(PFE_ROOT_ATTR)
    }
  }, [rootRef, optionsKey])
}
