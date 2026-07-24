import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useRef } from 'react'

export interface SidebarSplitterProps {
  readonly width: number
  readonly min: number
  readonly max: number
  readonly onResizeStart?: () => void
  readonly onResize: (width: number) => void
  readonly onResizeEnd?: () => void
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

export function SidebarSplitter({
  width,
  min,
  max,
  onResizeStart,
  onResize,
  onResizeEnd,
  onCollapse,
}: SidebarSplitterProps) {
  const dragSessionRef = useRef<SidebarDragSession | null>(null)

  const resizeEndRef = useRef(onResizeEnd)

  resizeEndRef.current = onResizeEnd

  const clamp = (nextWidth: number) => {
    return Math.max(min, Math.min(max, nextWidth))
  }

  const restoreBodyInteraction = useCallback((session: SidebarDragSession) => {
    document.body.style.cursor = session.previousBodyCursor

    document.body.style.userSelect = session.previousBodyUserSelect
  }, [])

  const finishResize = () => {
    const session = dragSessionRef.current

    if (!session) {
      return
    }

    /*
     * 先清除会话，再释放 pointer capture。
     * releasePointerCapture 会触发 lostpointercapture，
     * 先清除可以避免重复执行结束逻辑。
     */
    dragSessionRef.current = null

    if (session.element.hasPointerCapture(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId)
    }

    restoreBodyInteraction(session)
    resizeEndRef.current?.()
  }

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

  const handlePointerDown = (event: PointerEvent<HTMLHRElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    /*
     * 理论上不会同时存在两个拖拽会话，
     * 但如果旧会话因平台事件异常尚未结束，
     * 在开始新会话前先完成清理。
     */
    finishResize()

    const element = event.currentTarget

    const session: SidebarDragSession = {
      pointerId: event.pointerId,
      element,
      startX: event.clientX,
      startWidth: width,
      previousBodyCursor: document.body.style.cursor,
      previousBodyUserSelect: document.body.style.userSelect,
    }

    dragSessionRef.current = session

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    /*
     * Pointer Capture 是拖拽可靠性的关键。
     * 即使指针进入 tldraw 画布、其他面板或离开
     * 分隔条的可见区域，后续事件仍发送给此元素。
     */
    element.setPointerCapture(event.pointerId)

    onResizeStart?.()
  }

  const handlePointerMove = (event: PointerEvent<HTMLHRElement>) => {
    const session = dragSessionRef.current

    if (!session || session.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()

    const deltaX = event.clientX - session.startX

    const nextWidth = clamp(session.startWidth + deltaX)

    onResize(nextWidth)
  }

  const handlePointerUp = (event: PointerEvent<HTMLHRElement>) => {
    const session = dragSessionRef.current

    if (!session || session.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    finishResize()
  }

  const handlePointerCancel = (event: PointerEvent<HTMLHRElement>) => {
    const session = dragSessionRef.current

    if (!session || session.pointerId !== event.pointerId) {
      return
    }

    finishResize()
  }

  const handleLostPointerCapture = (event: PointerEvent<HTMLHRElement>) => {
    const session = dragSessionRef.current

    if (!session || session.pointerId !== event.pointerId) {
      return
    }

    finishResize()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLHRElement>) => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        onResize(clamp(width - 16))
        break

      case 'ArrowRight':
        event.preventDefault()
        onResize(clamp(width + 16))
        break

      case 'Home':
        event.preventDefault()
        onResize(min)
        break

      case 'End':
        event.preventDefault()
        onResize(max)
        break
    }
  }

  return (
    <hr
      aria-label="调整侧边栏宽度"
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={Math.round(width)}
      className={[
        'absolute -right-1 top-0',
        'z-40 h-full w-2',
        'cursor-col-resize',
        'touch-none select-none',
        'bg-transparent',
        'outline-none',
        'transition-colors',
        'hover:bg-primary/15',
        'focus-visible:bg-primary/25',
        'data-[resizing=true]:bg-primary/25',
      ].join(' ')}
      data-resizing={dragSessionRef.current !== null}
      data-window-drag-exclude
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onCollapse()
      }}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      role="separator"
      tabIndex={0}
    />
  )
}
