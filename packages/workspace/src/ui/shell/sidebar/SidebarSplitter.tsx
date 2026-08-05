import { useWorkspaceLayoutState } from '../workspace-layout-store'
import { useSidebarResize } from './useSidebarResize'

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
 * 它是一块命中区，不是一层涂料：自身永远透明。此前它在悬停、聚焦、拖拽三态
 * 各把整块 8px 刷成主色半透明，那块颜色压在分隔线上，于是用户看到的不是「线
 * 被抓住了」，而是「有个色块盖住了线」；而 chrome 行里那一小段竖线在它够不到
 * 的地方，两段因此对不齐。反馈现在归线本身：变深一档、加一个像素，两段同时
 * 变，规则在 workspace-shell.css。
 *
 * 那三个态不用往上传：workspace-shell.css 用 :has() 就地读这个元素的 :hover、
 * :focus-visible 与下面这个 data-resizing。
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
      className="workspace-sidebar-splitter absolute -right-1 top-0 z-40 h-full w-2 cursor-col-resize touch-none select-none border-0 bg-transparent outline-none"
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
