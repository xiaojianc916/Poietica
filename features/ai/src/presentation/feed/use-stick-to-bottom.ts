import { type RefObject, useCallback, useEffect, useRef } from 'react'

/**
 * Following the end of a scroller by intent, not by position.
 *
 * Once the user has scrolled up they are reading history, and a streaming
 * answer must never yank them back — so what is remembered is whether they were
 * at the end the last time they moved, not where the content happens to be now.
 * Kept in a ref: a scroll is not a render.
 *
 * The listener is passive, like the timeline's fade observer, so scrolling is
 * never held up waiting for it; the box is read inside the scroll callback,
 * where layout is already current.
 */
export function useStickToBottom(
  scrollRef: RefObject<HTMLElement | null>,
  thresholdPx: number,
): () => void {
  const pinned = useRef(true)

  useEffect(() => {
    const element = scrollRef.current

    if (element === null) {
      return undefined
    }

    const sync = () => {
      pinned.current =
        element.scrollHeight - element.scrollTop - element.clientHeight <= thresholdPx
    }

    element.addEventListener('scroll', sync, { passive: true })

    return () => {
      element.removeEventListener('scroll', sync)
    }
  }, [scrollRef, thresholdPx])

  return useCallback(() => {
    const element = scrollRef.current

    if (element !== null && pinned.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [scrollRef])
}
