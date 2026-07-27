import { useCallback } from 'react'

/** Within a pixel, an edge counts as reached: fractional scrollTop is normal. */
const SLACK = 1

type FadeEdges = 'both' | 'top' | 'bottom' | 'none'

function edgesOf(above: boolean, below: boolean): FadeEdges {
  if (above && below) {
    return 'both'
  }
  if (above) {
    return 'top'
  }
  if (below) {
    return 'bottom'
  }
  return 'none'
}

/**
 * Publishes which edges of a scroller have content out of view.
 *
 * A stylesheet cannot ask this question — scroll-state container queries exist
 * in one engine only, and this app ships on two — so it is measured here and
 * written to the element as `data-fade`, which CSS can then read.
 *
 * Written to the DOM rather than held in state on purpose: a chain of thought
 * being read would otherwise re-render the transcript on every scroll frame.
 * The ResizeObserver watches the box and its content, so text arriving mid
 * stream is accounted for without polling; the listener is passive, so reading
 * never waits on this.
 *
 * Returned as a ref callback with a cleanup, which React 19 calls on unmount.
 */
export function useScrollFade(): (node: HTMLElement | null) => void {
  return useCallback((node: HTMLElement | null) => {
    if (node === null) {
      return
    }

    const sync = () => {
      const above = node.scrollTop > SLACK
      const below = node.scrollHeight - node.clientHeight - node.scrollTop > SLACK
      node.dataset['fade'] = edgesOf(above, below)
    }

    const observer = new ResizeObserver(sync)
    observer.observe(node)
    const content = node.firstElementChild
    if (content !== null) {
      observer.observe(content)
    }
    node.addEventListener('scroll', sync, { passive: true })
    sync()

    return () => {
      node.removeEventListener('scroll', sync)
      observer.disconnect()
    }
  }, [])
}
