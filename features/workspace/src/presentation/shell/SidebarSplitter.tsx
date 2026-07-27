import { useSidebarResize } from './useSidebarResize'
import { useWorkspaceLayoutState } from './workspace-layout-store'

export interface SidebarSplitterProps {
  readonly width: number
  readonly min: number
  readonly max: number
  readonly onResize: (width: number) => void
  readonly onCollapse: () => void
}

/**
 * 侧边栏分隔条。
 *
 * 元素用 hr：它的隐式 ARIA 角色就是 separator，可聚焦时按规范可携带
 * aria-valuenow，因此不需要显式 role —— 那属于用 ARIA 重复原生语义。
 *
 * 拖拽态从 store 读，写入方是 useSidebarResize，读写各一处。
 */
export function SidebarSplitter({ width, min, max, onResize, onCollapse }: SidebarSplitterProps) {
  const { isResizing } = useWorkspaceLayoutState()

  const resize = useSidebarResize({ width, min, max, onResize, onCollapse })

  return (
    <hr
      aria-label="调整侧边栏宽度"
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={Math.round(width)}
      className="absolute -right-1 top-0 z-40 h-full w-2 cursor-col-resize touch-none select-none border-0 bg-transparent outline-none transition-colors hover:bg-primary/15 focus-visible:bg-primary/25 data-[resizing=true]:bg-primary/25"
      data-resizing={isResizing ? 'true' : 'false'}
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
