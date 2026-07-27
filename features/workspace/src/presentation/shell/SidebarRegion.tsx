import { PanelLeftClose } from '@mynaui/icons-react'
import { Button } from '@poietica/foundations-design-system'
import { type ReactNode, useEffect } from 'react'

import { SidebarSplitter } from './SidebarSplitter'
import type { WorkspaceLayoutMode } from './useWorkspaceLayout'
import { WORKSPACE_LAYOUT } from './workspace-layout'

export interface SidebarRegionProps {
  readonly mode: WorkspaceLayoutMode
  readonly isOpen: boolean
  readonly width: number
  readonly onClose: () => void
  readonly onResize: (width: number) => void
  readonly onResizeStart: () => void
  readonly onResizeEnd: () => void
  readonly children: ReactNode
}

/**
 * 侧边栏区域。
 *
 * 宽屏是栅格内的可拖拽列，窄屏是覆盖抽屉。两种形态共用同一份可见性状态，
 * 所以不会出现"两个侧边栏各自记住自己开没开"的情况。
 *
 * 定位一律相对于工作区外壳（外壳是 relative），不使用视口定位：抽屉与栅格
 * 必须共享同一个坐标系，否则外壳不铺满视口时会错位。
 */
export function SidebarRegion({
  mode,
  isOpen,
  width,
  onClose,
  onResize,
  onResizeStart,
  onResizeEnd,
  children,
}: SidebarRegionProps) {
  const isDocked = mode !== 'narrow' && isOpen
  const isDrawer = mode === 'narrow' && isOpen

  /*
   * 覆盖抽屉是模态形态，Escape 必须能关闭它。遮罩按钮只覆盖鼠标路径。
   */
  useEffect(() => {
    if (!isDrawer) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isDrawer, onClose])

  return (
    <>
      <div
        aria-hidden={!isDocked}
        className="relative z-20 row-[2/-1] min-h-0 min-w-0 overflow-visible border-r border-divider bg-sidebar"
        style={{
          borderRightWidth: isDocked ? 1 : 0,
          gridColumn: 2,
          pointerEvents: isDocked ? 'auto' : 'none',
        }}
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
            onResizeEnd={onResizeEnd}
            onResizeStart={onResizeStart}
            width={width}
          />
        ) : null}
      </div>

      {isDrawer ? (
        <div className="absolute inset-x-0 bottom-0 top-[var(--chrome-height)] z-[var(--ui-z-popover)]">
          <button
            aria-label="关闭工作区导航"
            className="absolute inset-0 cursor-default bg-black/35"
            onClick={onClose}
            type="button"
          />

          <aside
            aria-label="工作区导航"
            className="relative ml-[var(--activity-rail-width)] h-full w-[min(82vw,320px)] border-r border-divider bg-sidebar shadow-2xl"
          >
            {children}

            <Button
              aria-label="关闭侧边栏"
              className="absolute right-2 top-2"
              onClick={onClose}
              size="icon"
              type="button"
              variant="ghost"
            >
              <PanelLeftClose aria-hidden="true" className="size-4" />
            </Button>
          </aside>
        </div>
      ) : null}
    </>
  )
}
