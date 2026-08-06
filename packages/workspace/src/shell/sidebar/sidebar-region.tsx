import type { ReactNode } from 'react'
import type { WorkspaceLayoutMode } from '../use-workspace-layout'
import { WORKSPACE_LAYOUT } from '../workspace-layout'
import { SidebarSplitter } from './sidebar-splitter'

export interface SidebarRegionProps {
  readonly mode: WorkspaceLayoutMode
  readonly isOpen: boolean
  readonly width: number
  readonly onClose: () => void
  readonly onResize: (width: number) => void
  readonly children: ReactNode
}

/**
 * 侧边栏区域。
 *
 * 宽屏是栅格内的可拖拽列；窗口收窄过断点，它收起 —— 不是换成另一种形态。
 * 此前窄屏把它渲成一张模态抽屉，而可见性状态在跨越断点时仍然是开着的，
 * 于是窗口一缩，抽屉就自动弹出来盖住主区。收起而不是换壳：可见性是用户
 * 意图，唯一所有者是 workspace-layout-store；呈现由布局模式在这里派生，
 * 扩回宽屏自然还原，不需要任何东西记得「刚才是不是开着」。
 *
 * 栅格格位与空列的指针穿透由 workspace-shell.css 拥有，这里不再内联坐标。
 */
export function SidebarRegion({
  mode,
  isOpen,
  width,
  onClose,
  onResize,
  children,
}: SidebarRegionProps) {
  const isDocked = mode !== 'narrow' && isOpen

  return (
    <div
      aria-hidden={!isDocked}
      className="workspace-shell__sidebar relative z-20 min-h-0 min-w-0 overflow-visible bg-sidebar"
    >
      {mode === 'narrow' ? null : (
        <div className="h-full min-h-0 w-full overflow-hidden">
          <div className="h-full min-h-0" style={{ width }}>
            {children}
          </div>
        </div>
      )}

      {isDocked ? (
        <SidebarSplitter
          max={WORKSPACE_LAYOUT.sidebar.maxWidth}
          min={WORKSPACE_LAYOUT.sidebar.minWidth}
          onCollapse={onClose}
          onResize={onResize}
          width={width}
        />
      ) : null}
    </div>
  )
}
