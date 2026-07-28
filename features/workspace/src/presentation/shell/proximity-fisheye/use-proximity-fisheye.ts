// poietica:proximity-fisheye@v2
// Proximity-based fisheye ("Dock magnification") for the conversation minimap.
//
// Design notes:
//  - Distance uses the padded rect SDF, not the element centre, so a tall thin
//    rail reacts correctly along its whole height.
//  - Enter and exit thresholds differ (hysteresis) to kill boundary flicker.
//  - Per-item weight is a Gaussian of the vertical pointer distance.
//  - The rAF loop writes CSS custom properties, so React never re-renders on move.
//  - Disabled for coarse pointers and prefers-reduced-motion.

import { type RefObject, useEffect, useRef } from 'react'
import {
  PFE_ACTIVE_ATTR,
  PFE_ITEM_SELECTOR,
  PFE_ROOT_ATTR,
  PFE_WEIGHT_VAR,
  PROXIMITY_FISHEYE_DEFAULTS,
  type ProximityFisheyeOptions,
} from './proximity-fisheye.constants'

function clamp01(value: number): number {
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}

export function useProximityFisheye(
  rootRef: RefObject<HTMLElement | null>,
  overrides: Partial<ProximityFisheyeOptions> = {},
): void {
  const overridesRef = useRef(overrides)
  overridesRef.current = overrides
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

    const raw = overridesRef.current
    const opts: ProximityFisheyeOptions = {
      ...PROXIMITY_FISHEYE_DEFAULTS,
      ...raw,
      hitPadding: { ...PROXIMITY_FISHEYE_DEFAULTS.hitPadding, ...(raw.hitPadding ?? {}) },
    }
    if (opts.exitDistance <= opts.enterDistance) {
      throw new Error('[proximity-fisheye] exitDistance must be greater than enterDistance')
    }

    root.setAttribute(PFE_ROOT_ATTR, '')

    let items: HTMLElement[] = []
    let centers: number[] = []
    let sigma = 1
    let rect = root.getBoundingClientRect()

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
    }

    measure()

    let pointerY = Number.NEGATIVE_INFINITY
    let target = 0
    let activation = 0
    let raf = 0
    let disposed = false

    const distanceToRect = (x: number, y: number): number => {
      const pad = opts.hitPadding
      const dx = Math.max(rect.left - pad.left - x, 0, x - (rect.right + pad.right))
      const dy = Math.max(rect.top - pad.top - y, 0, y - (rect.bottom + pad.bottom))
      return Math.hypot(dx, dy)
    }

    const paint = (): void => {
      items.forEach((element, index) => {
        const dy = pointerY - centers[index]
        const gauss = Math.exp(-(dy * dy) / (2 * sigma * sigma))
        const raw = gauss * activation
        const weight = raw < opts.epsilon ? 0 : raw
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
      const ramp = (opts.exitDistance - distance) / (opts.exitDistance - opts.enterDistance)
      target = clamp01(ramp)
      schedule()
    }

    const onPointerOut = (): void => {
      target = 0
      schedule()
    }

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(root)
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
