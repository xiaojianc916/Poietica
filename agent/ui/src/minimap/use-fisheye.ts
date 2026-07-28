import { useCallback } from 'react'

/** Half-width of the pull. Beyond roughly twice this a bar is at rest. */
const FALLOFF_PX = 72

/**
 * Dock magnification for a vertical rail.
 *
 * Each bar is given a weight between 0 and 1 from its distance to the pointer,
 * on a gaussian falloff, and the stylesheet turns that weight into a length.
 * The weight is written to the element as a custom property rather than held
 * in state, for the same reason the scroll fade is: a pointer crossing the
 * rail would otherwise re-render the transcript on every frame.
 *
 * One write per animation frame, no matter how many move events the platform
 * delivers, and the rail's own box is read once per frame rather than per
 * event. Returned as a ref callback with a cleanup, which React 19 calls on
 * unmount.
 */
export function useFisheye(): (node: HTMLElement | null) => void {
  return useCallback((node: HTMLElement | null) => {
    if (node === null) {
      return
    }

    let frame = 0
    /** Viewport coordinate of the pointer; NaN means it is away. */
    let pointerY = Number.NaN

    const paint = () => {
      frame = 0
      const origin = node.getBoundingClientRect().top
      const away = Number.isNaN(pointerY)

      /* The rail's own children, not a class name owned by another file. */
      for (const bar of node.querySelectorAll<HTMLElement>(':scope > *')) {
        const center = origin + bar.offsetTop + bar.offsetHeight / 2
        const ratio = (center - pointerY) / FALLOFF_PX
        const weight = away ? 0 : Math.exp(-(ratio * ratio))
        bar.style.setProperty('--cp-rail-weight', weight.toFixed(3))
      }
    }

    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(paint)
      }
    }

    const track = (event: PointerEvent) => {
      pointerY = event.clientY
      schedule()
    }

    const release = () => {
      pointerY = Number.NaN
      schedule()
    }

    node.addEventListener('pointermove', track, { passive: true })
    node.addEventListener('pointerleave', release, { passive: true })

    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame)
      }
      node.removeEventListener('pointermove', track)
      node.removeEventListener('pointerleave', release)
    }
  }, [])
}
