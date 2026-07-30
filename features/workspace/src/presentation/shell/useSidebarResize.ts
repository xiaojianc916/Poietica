import { type KeyboardEvent, type MouseEvent, type PointerEvent, useRef } from 'react'

import { workspaceLayoutStore } from './workspace-layout-store'

export interface SidebarResizeOptions {
  readonly width: number
  readonly min: number
  readonly max: number
  readonly onResize: (width: number) => void
  readonly onCollapse: () => void
}

interface SidebarDragSession {
  readonly pointerId: number
  readonly element: HTMLHRElement
  readonly startX: number
  readonly startWidth: number
}

export interface SidebarResizeBindings {
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
 * 分隔条本身，即使指针越过主区或离开窗口，所以不需要 document 上的全局监听。
 *
 * 拖拽态写进 workspaceLayoutStore，不再由本 hook 自持一份 useState 再通过
 * onResizeStart / onResizeEnd 回调向上同步——那让同一个布尔量有了两个所有者。
 */
export function useSidebarResize({
  width,
  min,
  max,
  onResize,
  onCollapse,
}: SidebarResizeOptions): SidebarResizeBindings {
  const sessionRef = useRef<SidebarDragSession | null>(null)

  const clamp = (next: number): number => Math.max(min, Math.min(max, Math.round(next)))

  const settle = (session: SidebarDragSession, finalWidth: number): void => {
    sessionRef.current = null

    /* lostpointercapture 时捕获已释放，此时 release 会抛 NotFoundError。 */
    if (session.element.hasPointerCapture(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId)
    }

    onResize(finalWidth)
    workspaceLayoutStore.setResizing(false)
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

    workspaceLayoutStore.setResizing(true)
    element.setPointerCapture(event.pointerId)

    /* 取得焦点后，拖拽中的 Esc 与拖拽后的方向键微调才能落到分隔条上。 */
    element.focus()
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
    onDoubleClick: handleDoubleClick,
    onKeyDown: handleKeyDown,
    onLostPointerCapture: handlePointerEnd,
    onPointerCancel: handlePointerEnd,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerEnd,
  }
}
