import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

export interface SidebarResizeOptions {
  readonly width: number
  readonly min: number
  readonly max: number
  readonly onResizeStart?: () => void
  readonly onResize: (width: number) => void
  readonly onResizeEnd?: () => void
  readonly onCollapse: () => void
}

interface SidebarResizeCallbacks {
  /*
   * These keys always exist in callbacksRef.current.
   * Their values may be undefined when the public
   * options were omitted.
   */
  readonly onResizeStart: (() => void) | undefined

  readonly onResize: (width: number) => void

  readonly onResizeEnd: (() => void) | undefined

  readonly onCollapse: () => void
}

interface SidebarDragSession {
  readonly pointerId: number
  readonly element: HTMLHRElement
  readonly startX: number
  readonly startWidth: number
  readonly previousBodyCursor: string
  readonly previousBodyUserSelect: string
}

export interface SidebarResizeBindings {
  readonly isResizing: boolean

  readonly onDoubleClick: (event: React.MouseEvent<HTMLHRElement>) => void

  readonly onKeyDown: (event: KeyboardEvent<HTMLHRElement>) => void

  readonly onLostPointerCapture: (event: PointerEvent<HTMLHRElement>) => void

  readonly onPointerCancel: (event: PointerEvent<HTMLHRElement>) => void

  readonly onPointerDown: (event: PointerEvent<HTMLHRElement>) => void

  readonly onPointerMove: (event: PointerEvent<HTMLHRElement>) => void

  readonly onPointerUp: (event: PointerEvent<HTMLHRElement>) => void
}

/**
 * Owns the complete sidebar resize session.
 *
 * Pointer capture is required because a resize may
 * cross the tldraw canvas, another panel, or the
 * visible bounds of the separator.
 */
export function useSidebarResize({
  width,
  min,
  max,
  onResizeStart,
  onResize,
  onResizeEnd,
  onCollapse,
}: SidebarResizeOptions): SidebarResizeBindings {
  const dragSessionRef = useRef<SidebarDragSession | null>(null)

  const [isResizing, setResizing] = useState(false)

  const widthRef = useRef(width)
  const minRef = useRef(min)
  const maxRef = useRef(max)

  widthRef.current = width
  minRef.current = min
  maxRef.current = max

  const callbacksRef = useRef<SidebarResizeCallbacks>({
    onResizeStart,
    onResize,
    onResizeEnd,
    onCollapse,
  })

  callbacksRef.current = {
    onResizeStart,
    onResize,
    onResizeEnd,
    onCollapse,
  }

  const clamp = useCallback((nextWidth: number) => {
    return Math.max(minRef.current, Math.min(maxRef.current, nextWidth))
  }, [])

  const restoreBodyInteraction = useCallback((session: SidebarDragSession) => {
    document.body.style.cursor = session.previousBodyCursor

    document.body.style.userSelect = session.previousBodyUserSelect
  }, [])

  const finishResize = useCallback(() => {
    const session = dragSessionRef.current

    if (!session) {
      return
    }

    // Clear before releasing capture because
    // releasePointerCapture may synchronously
    // dispatch lostpointercapture.
    dragSessionRef.current = null
    setResizing(false)

    if (session.element.hasPointerCapture(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId)
    }

    restoreBodyInteraction(session)

    callbacksRef.current.onResizeEnd?.()
  }, [restoreBodyInteraction])

  useEffect(() => {
    return () => {
      const session = dragSessionRef.current

      if (!session) {
        return
      }

      dragSessionRef.current = null
      restoreBodyInteraction(session)
    }
  }, [restoreBodyInteraction])

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLHRElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      finishResize()

      const element = event.currentTarget

      const session: SidebarDragSession = {
        pointerId: event.pointerId,
        element,
        startX: event.clientX,
        startWidth: widthRef.current,
        previousBodyCursor: document.body.style.cursor,
        previousBodyUserSelect: document.body.style.userSelect,
      }

      dragSessionRef.current = session

      setResizing(true)

      document.body.style.cursor = 'col-resize'

      document.body.style.userSelect = 'none'

      element.setPointerCapture(event.pointerId)

      callbacksRef.current.onResizeStart?.()
    },
    [finishResize],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLHRElement>) => {
      const session = dragSessionRef.current

      if (!session || session.pointerId !== event.pointerId) {
        return
      }

      event.preventDefault()

      const deltaX = event.clientX - session.startX

      callbacksRef.current.onResize(clamp(session.startWidth + deltaX))
    },
    [clamp],
  )

  const handlePointerEnd = useCallback(
    (event: PointerEvent<HTMLHRElement>) => {
      const session = dragSessionRef.current

      if (!session || session.pointerId !== event.pointerId) {
        return
      }

      event.preventDefault()
      finishResize()
    },
    [finishResize],
  )

  const handlePointerCancel = useCallback(
    (event: PointerEvent<HTMLHRElement>) => {
      const session = dragSessionRef.current

      if (!session || session.pointerId !== event.pointerId) {
        return
      }

      finishResize()
    },
    [finishResize],
  )

  const handleLostPointerCapture = useCallback(
    (event: PointerEvent<HTMLHRElement>) => {
      const session = dragSessionRef.current

      if (!session || session.pointerId !== event.pointerId) {
        return
      }

      finishResize()
    },
    [finishResize],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLHRElement>) => {
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          callbacksRef.current.onResize(clamp(widthRef.current - 16))
          break

        case 'ArrowRight':
          event.preventDefault()
          callbacksRef.current.onResize(clamp(widthRef.current + 16))
          break

        case 'Home':
          event.preventDefault()
          callbacksRef.current.onResize(minRef.current)
          break

        case 'End':
          event.preventDefault()
          callbacksRef.current.onResize(maxRef.current)
          break
      }
    },
    [clamp],
  )

  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLHRElement>) => {
    event.preventDefault()
    event.stopPropagation()

    callbacksRef.current.onCollapse()
  }, [])

  return {
    isResizing,
    onDoubleClick: handleDoubleClick,
    onKeyDown: handleKeyDown,
    onLostPointerCapture: handleLostPointerCapture,
    onPointerCancel: handlePointerCancel,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerEnd,
  }
}
