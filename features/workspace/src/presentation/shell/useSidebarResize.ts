import { type KeyboardEvent, type MouseEvent, type PointerEvent, useRef, useState } from 'react'

export interface SidebarResizeOptions {
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
}

export interface SidebarResizeBindings {
  readonly isResizing: boolean
  readonly onDoubleClick: (event: MouseEvent<HTMLHRElement>) => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLHRElement>) => void
  readonly onLostPointerCapture: (event: PointerEvent<HTMLHRElement>) => void
  readonly onPointerCancel: (event: PointerEvent<HTMLHRElement>) => void
  readonly onPointerDown: (event: PointerEvent<HTMLHRElement>) => void
  readonly onPointerMove: (event: PointerEvent<HTMLHRElement>) => void
  readonly onPointerUp: (event: PointerEvent<HTMLHRElement>) => void
}

/**
 * 侧边栏分隔条的拖拽会话。
 *
 * 指针捕获交给平台：一次 setPointerCapture 之后，move / up / cancel 都会派发到
 * 分隔条本身，即使指针越过画布或离开窗口，所以不需要 document 上的全局监听，
 * 也不需要接管 body 的光标与选区——分隔条自身的 cursor-col-resize 与
 * select-none 在捕获期间持续生效。
 *
 * 这里也不再叠加节流：pointermove 由浏览器与显示帧对齐派发（合并事件），
 * 而宽度写盘已经在 workspaceLayoutStore 里合并到一帧。
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
  const sessionRef = useRef<SidebarDragSession | null>(null)

  const [isResizing, setResizing] = useState(false)

  const clamp = (next: number): number => Math.max(min, Math.min(max, Math.round(next)))

  const settle = (session: SidebarDragSession, finalWidth: number): void => {
    sessionRef.current = null
    setResizing(false)

    if (session.element.hasPointerCapture(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId)
    }

    onResize(finalWidth)
    onResizeEnd?.()
  }

  const handlePointerDown = (event: PointerEvent<HTMLHRElement>): void => {
    if (event.button !== 0 || sessionRef.current !== null) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const element = event.currentTarget

    sessionRef.current = {
      pointerId: event.pointerId,
      element,
      startX: event.clientX,
      startWidth: width,
    }

    setResizing(true)
    element.setPointerCapture(event.pointerId)

    /* 取得焦点后，拖拽中的 Esc 与拖拽后的方向键微调才能落到分隔条上。 */
    element.focus()

    onResizeStart?.()
  }

  const handlePointerMove = (event: PointerEvent<HTMLHRElement>): void => {
    const session = sessionRef.current

    if (session?.pointerId !== event.pointerId) {
      return
    }

    onResize(clamp(session.startWidth + event.clientX - session.startX))
  }

  const handlePointerEnd = (event: PointerEvent<HTMLHRElement>): void => {
    const session = sessionRef.current

    if (session?.pointerId !== event.pointerId) {
      return
    }

    settle(session, clamp(session.startWidth + event.clientX - session.startX))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLHRElement>): void => {
    const session = sessionRef.current

    /* 拖拽中按 Esc 放弃本次调整并回到起始宽度，与通用拖拽语义一致。 */
    if (event.key === 'Escape') {
      if (session !== null) {
        event.preventDefault()
        settle(session, session.startWidth)
      }

      return
    }

    const step = event.shiftKey ? 64 : 16

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        onResize(clamp(width - step))
        break

      case 'ArrowRight':
        event.preventDefault()
        onResize(clamp(width + step))
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

  const handleDoubleClick = (event: MouseEvent<HTMLHRElement>): void => {
    event.preventDefault()
    event.stopPropagation()

    onCollapse()
  }

  return {
    isResizing,
    onDoubleClick: handleDoubleClick,
    onKeyDown: handleKeyDown,
    onLostPointerCapture: handlePointerEnd,
    onPointerCancel: handlePointerEnd,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerEnd,
  }
}
