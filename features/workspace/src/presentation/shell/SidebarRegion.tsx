import { Drawer } from '@poietica/foundations-design-system'
import type { ReactNode } from 'react'

import { SidebarSplitter } from './SidebarSplitter'
import type { WorkspaceLayoutMode } from './useWorkspaceLayout'
import { WORKSPACE_LAYOUT } from './workspace-layout'

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
 * 宽屏是栅格内的可拖拽列，窄屏是模态抽屉，两种形态共用同一份可见性状态。
 *
 * 抽屉的模态语义（焦点陷阱、初始与归还焦点、Escape、外部点击、滚动锁、
 * aria-modal）由设计系统 Drawer 交给 Base UI。此前这里自己监听 window
 * keydown 兜 Escape，并用一个铺满的 <button> 冒充遮罩：那样只挡住鼠标路径，
 * 键盘焦点仍会 Tab 到抽屉背后的内容上，aside 也没有任何对话框角色。
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
    <>
      <div
        aria-hidden={!isDocked}
        className="workspace-shell__sidebar relative z-20 min-h-0 min-w-0 overflow-visible border-r border-divider bg-sidebar"
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

      <Drawer
        closeLabel="关闭侧边栏"
        onOpenChange={(open) => {
          if (!open) {
            onClose()
          }
        }}
        open={mode === 'narrow' && isOpen}
        title="工作区导航"
      >
        {children}
      </Drawer>
    </>
  )
}
