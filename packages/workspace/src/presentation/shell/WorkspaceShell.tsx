import { TooltipProvider } from '@poietica/ui'

import type { WorkspaceShellProps } from '../../contracts/shell'
import { SidebarRegion } from './sidebar/SidebarRegion'
import { useWorkspaceLayoutMode } from './useWorkspaceLayout'
import { WorkspaceFrame } from './WorkspaceFrame'
import { encodeWorkbenchTabDomId } from './workbench-tabs/workbench-tabs-model'
import { useWorkspaceLayoutState, workspaceLayoutStore } from './workspace-layout-store'

/**
 * 工作区外壳。
 *
 * 职责只有一件：把布局意图翻译成停靠状态位，并把 Part 表装进 WorkspaceFrame。
 * 栅格坐标属于 workspace-shell.css，区域内部形态属于区域组件，
 * 拖拽态属于 workspaceLayoutStore。
 */
export function WorkspaceShell({ model, parts }: WorkspaceShellProps) {
  const mode = useWorkspaceLayoutMode()
  const { sidebarOpen, sidebarWidth, isResizing } = useWorkspaceLayoutState()
  const { setSidebarOpen, setSidebarWidth } = workspaceLayoutStore

  const dockSidebar = mode !== 'narrow' && sidebarOpen
  const activeTabDomId = encodeWorkbenchTabDomId(model.activeTabId)
  const isTabPanel = parts.main.label === undefined

  return (
    <TooltipProvider delayDuration={450}>
      <WorkspaceFrame
        chrome={
          <header className="workspace-shell__chrome min-h-0 min-w-0 bg-chrome">
            {parts.chrome.content}
          </header>
        }
        disableLayoutAnimation={isResizing}
        isSidebarDocked={dockSidebar}
        main={
          <section
            aria-label="内容区"
            className="workspace-shell__main relative z-10 min-h-0 min-w-0 overflow-hidden bg-background"
          >
            <main
              aria-label={parts.main.label}
              aria-labelledby={isTabPanel ? \`workbench-tab-\${activeTabDomId}\` : undefined}
              className="relative h-full min-h-0 min-w-0 overflow-hidden"
              id={isTabPanel ? \`workbench-panel-\${activeTabDomId}\` : undefined}
              role={isTabPanel ? 'tabpanel' : 'region'}
            >
              {parts.main.content}
            </main>
          </section>
        }
        overlays={parts.overlay?.content}
        sidebar={
          <SidebarRegion
            isOpen={sidebarOpen}
            mode={mode}
            onClose={() => {
              setSidebarOpen(false)
            }}
            onResize={setSidebarWidth}
            width={sidebarWidth}
          >
            {parts.sidebar.content}
          </SidebarRegion>
        }
        sidebarColumnWidth={dockSidebar ? sidebarWidth : 0}
      />
    </TooltipProvider>
  )
}
