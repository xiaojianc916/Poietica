import { useEffect } from 'react'

/** Reads a duration token, so timing stays a design decision in CSS. */
function durationOf(element: Element, token: string, fallback: number): number {
  const raw = getComputedStyle(element).getPropertyValue(token).trim()

  if (raw.endsWith('ms')) {
    return Number.parseFloat(raw)
  }
  if (raw.endsWith('s')) {
    return Number.parseFloat(raw) * 1000
  }

  return fallback
}

function easingOf(element: Element): string {
  return getComputedStyle(element).getPropertyValue('--cp-motion-ease').trim() || 'ease-out'
}

/**
 * Lets the composer grow into a new height instead of jumping to it.
 *
 * The stylesheet owns the height: the box is field-sizing: content, so this
 * hook cannot set it and does not try. It replays the previous box onto the new
 * one with fill: 'none', which commits nothing — the resting height is always
 * whatever CSS resolved, animation or not.
 *
 * Two rules make it steady, and both were the previous version’s bugs:
 *
 *   - it animates this element and nothing else. Compensating for the growth
 *     elsewhere in the layout was correct only while the column was centred by
 *     auto margins; spacers hold it now, so a counter-translate is pure jolt.
 *   - observations caused by the replay are ignored outright. The animation
 *     changes the border box, the observer fires, and treating those frames as
 *     real resizes overwrote the height being animated from — so the next real
 *     change was measured against a value from the middle of an animation.
 */
export function useEditorGrowth(editorId: string): void {
  useEffect(() => {
    const editor = document.getElementById(editorId)

    if (!editor || typeof editor.animate !== 'function' || typeof ResizeObserver === 'undefined') {
      return
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

    let previous = editor.getBoundingClientRect().height
    let firstObservation = true
    let growth: Animation | null = null

    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1)

      if (!entry) {
        return
      }

      if (growth?.playState === 'running') {
        return
      }

      const next = entry.borderBoxSize?.[0]?.blockSize ?? editor.getBoundingClientRect().height
      const from = previous

      previous = next

      if (firstObservation) {
        firstObservation = false
        return
      }

      if (reduced.matches || Math.abs(next - from) < 1) {
        return
      }

      growth?.cancel()
      growth = editor.animate(
        [{ blockSize: `${String(from)}px` }, { blockSize: `${String(next)}px` }],
        {
          duration: durationOf(editor, '--cp-motion-grow', 240),
          easing: easingOf(editor),
          fill: 'none',
        },
      )
    })

    observer.observe(editor)

    return () => {
      growth?.cancel()
      observer.disconnect()
    }
  }, [editorId])
}
