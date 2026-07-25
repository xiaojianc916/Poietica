import { useEffect } from 'react'

/**
 * Reads a duration token from computed style so timing stays a design
 * decision expressed in composer-metrics.css.
 */
const durationOf = (element: Element, token: string, fallback: number): number => {
  const raw = getComputedStyle(element).getPropertyValue(token).trim()

  if (raw.endsWith('ms')) return Number.parseFloat(raw)
  if (raw.endsWith('s')) return Number.parseFloat(raw) * 1000

  return fallback
}

/**
 * Softens the moment the composer changes size.
 *
 * The stylesheet remains the only owner of the editor's height: this hook
 * merely replays the previous box for one beat (`fill: 'none'`, nothing
 * committed) so the new height is arrived at rather than jumped to. The
 * surrounding column is centred, so a growing editor would also shove the
 * masthead upwards — the counter-translate cancels that shove and lets it
 * resolve over the same beat.
 */
export function useFluidResize(editorId: string, columnId?: string): void {
  useEffect(() => {
    const editor = document.getElementById(editorId)

    if (!editor || typeof editor.animate !== 'function' || typeof ResizeObserver === 'undefined') {
      return
    }

    const column = columnId === undefined ? null : document.getElementById(columnId)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

    let previous = editor.getBoundingClientRect().height
    let firstObservation = true
    let playing = false

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]

      if (!entry) return

      const next = entry.borderBoxSize?.[0]?.blockSize ?? editor.getBoundingClientRect().height
      const delta = previous - next

      previous = next

      if (firstObservation) {
        firstObservation = false
        return
      }

      /* Our own animation resizes the editor; ignore those frames. */
      if (playing || reduced.matches || Math.abs(delta) < 1) {
        return
      }

      const duration = durationOf(editor, '--cp-motion-grow', 240)
      const easing =
        getComputedStyle(editor).getPropertyValue('--cp-motion-ease').trim() || 'ease-out'

      playing = true

      const growth = editor.animate(
        [{ blockSize: `${next + delta}px` }, { blockSize: `${next}px` }],
        { duration, easing, fill: 'none' },
      )

      column?.animate(
        [{ transform: `translateY(${delta / -2}px)` }, { transform: 'translateY(0)' }],
        {
          duration,
          easing,
          fill: 'none',
        },
      )

      const release = () => {
        playing = false
        previous = editor.getBoundingClientRect().height
      }

      growth.finished.then(release, release)
    })

    observer.observe(editor)

    return () => {
      observer.disconnect()
    }
  }, [columnId, editorId])
}
