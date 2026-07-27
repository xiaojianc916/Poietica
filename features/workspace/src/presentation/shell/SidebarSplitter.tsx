import { useSidebarResize } from './useSidebarResize'

export interface SidebarSplitterProps {
  readonly width: number
  readonly min: number
  readonly max: number
  readonly onResizeStart?: () => void
  readonly onResize: (width: number) => void
  readonly onResizeEnd?: () => void
  readonly onCollapse: () => void
}

/**
 * Accessible workspace sidebar separator.
 *
 * Rendering and ARIA remain in this component;
 * drag-session mechanics live in useSidebarResize.
 */
export function SidebarSplitter({
  width,
  min,
  max,
  onResizeStart,
  onResize,
  onResizeEnd,
  onCollapse,
}: SidebarSplitterProps) {
  const resize = useSidebarResize({
    width,
    min,
    max,
    ...(onResizeStart ? { onResizeStart } : {}),
    onResize,
    ...(onResizeEnd ? { onResizeEnd } : {}),
    onCollapse,
  })

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
      data-resizing={resize.isResizing ? 'true' : 'false'}
      onDoubleClick={resize.onDoubleClick}
      onKeyDown={resize.onKeyDown}
      onLostPointerCapture={resize.onLostPointerCapture}
      onPointerCancel={resize.onPointerCancel}
      onPointerDown={resize.onPointerDown}
      onPointerMove={resize.onPointerMove}
      onPointerUp={resize.onPointerUp}
      tabIndex={0}
    />
  )
}
