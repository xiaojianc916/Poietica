import { TooltipProvider } from '@poietica/foundations-design-system'
import { useState } from 'react'

import type { WorkspaceShellProps } from '../../contracts/shell-contract'
import type { WorkspaceSurfaceId } from '../../contracts/workbench-contract'
import { InspectorHost } from '../inspector/InspectorHost'
import { StatusBarHost } from '../status/StatusBarHost'
import { InspectorRegion } from './InspectorRegion'
import { SidebarRegion } from './SidebarRegion'
import { describeWorkspaceSurface } from './surface-registry'
import { useWorkspaceLayoutMode } from './useWorkspaceLayout'
import { WorkspaceFrame } from './WorkspaceFrame'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { encodeWorkbenchTabDomId } from './workbench-tabs/workbench-tabs-model'
import { WORKSPACE_LAYOUT } from './workspace-layout'
import { useWorkspaceLayoutState, workspaceLayoutStore } from './workspace-layout-store'

const WORKSPACE_GRID_COLUMNS = [
  'var(--workspace-sidebar-column-width, 0px)',
  'minmax(0, 1fr)',
  'var(--workspace-inspector-column-width, 0px)',
].join(' ')

/**
 * 工作区外壳。
 *
 * 职责只有一件事：决定栅格几何，并把各区域装进 WorkspaceFrame。每个区域的
 * 内部形态（停靠列 / 覆盖抽屉 / 开合控件）由区域组件自己拥有。
 */
export function WorkspaceShell({
  model,
  actions,
  pages,
  renderChrome,
  mainContent,
  inspector,
  inspectorAvailable,
  statusContent,
  panelRenderers,
  assistantOverlay,
  overlays,
}: WorkspaceShellProps) {
  const mode = useWorkspaceLayoutMode()

  /*
   * 侧边栏与属性栏的可见性、宽度由 workspaceLayoutStore 拥有：它跨会话保留，
   * 并且要能被命令面板与快捷键驱动。isResizing 是单次拖拽内的瞬时状态。
   */
  const { sidebarOpen, sidebarWidth, inspectorOpen } = useWorkspaceLayoutState()

  const { setSidebarOpen, setSidebarWidth, setInspectorOpen } = workspaceLayoutStore

  const [isResizing, setResizing] = useState(false)

  const activeSurfaceId: WorkspaceSurfaceId =
    model.activeSurface.kind === 'workspace' ? model.activeSurface.surfaceId : 'pages'

  const hasCanvas = model.activeSurface.kind === 'canvas'
  const dockSidebar = mode !== 'narrow' && sidebarOpen
  const dockInspector = inspectorAvailable && inspectorOpen && hasCanvas

  const activeTabDomId = encodeWorkbenchTabDomId(model.activeTabId)

  return (
    <TooltipProvider delayDuration={450}>
      <WorkspaceFrame
        canvas={
          <section
            aria-label="内容区"
            className="relative z-10 row-2 min-h-0 min-w-0 overflow-hidden border-r border-divider bg-background"
            style={{ borderRightWidth: dockInspector ? 1 : 0, gridColumn: 2 }}
          >
            <main
              aria-labelledby={`workbench-tab-${activeTabDomId}`}
              className="relative h-full min-h-0 min-w-0 overflow-hidden"
              id={`workbench-panel-${activeTabDomId}`}
              role="tabpanel"
            >
              {mainContent}
            </main>
          </section>
        }
        chrome={
          <header className="col-span-full row-1 min-h-0 min-w-0 bg-chrome">
            {renderChrome({
              isSidebarOpen: sidebarOpen,
              tabs: model.tabs,
              onSidebarToggle: workspaceLayoutStore.toggleSidebar,
              onActivateTab: actions.activateTab,
              onCloseTab: actions.closeTab,
              onMoveTab: actions.moveTab,
              onCreateCanvas: actions.createCanvas,
            })}
          </header>
        }
        disableLayoutAnimation={isResizing}
        gridTemplateColumns={WORKSPACE_GRID_COLUMNS}
        gridTemplateRows={
          hasCanvas
            ? 'var(--chrome-height) minmax(0, 1fr) var(--status-height)'
            : 'var(--chrome-height) minmax(0, 1fr)'
        }
        inspector={
          hasCanvas && inspectorAvailable ? (
            <InspectorRegion isDocked={dockInspector} onOpenChange={setInspectorOpen}>
              <InspectorHost>{inspector}</InspectorHost>
            </InspectorRegion>
          ) : null
        }
        inspectorColumnWidth={dockInspector ? WORKSPACE_LAYOUT.inspector.width : 0}
        overlays={
          <>
            {assistantOverlay}
            {overlays}
          </>
        }
        sidebar={
          <SidebarRegion
            isOpen={sidebarOpen}
            mode={mode}
            onClose={() => {
              setSidebarOpen(false)
            }}
            onResize={setSidebarWidth}
            onResizeEnd={() => {
              setResizing(false)
            }}
            onResizeStart={() => {
              setResizing(true)
            }}
            width={sidebarWidth}
          >
            <WorkspaceSidebar
              activeNavigationItem={activeSurfaceId}
              onActivatePage={actions.activatePage}
              onCreateConversation={() => {
                actions.openWorkspaceSurface('ai', describeWorkspaceSurface('ai').title)
                setSidebarOpen(true)
              }}
              onCreatePage={actions.createPage}
              onDeveloperToolsOpen={actions.openDeveloperTools}
              onSettingsOpen={actions.openSettingsWindow}
              onSurfaceActivate={(surfaceId) => {
                actions.openWorkspaceSurface(surfaceId, describeWorkspaceSurface(surfaceId).title)
                setSidebarOpen(true)
              }}
              {...(panelRenderers === undefined ? {} : { panelRenderers })}
              pages={pages}
            />
          </SidebarRegion>
        }
        sidebarColumnWidth={dockSidebar ? sidebarWidth : 0}
        statusBar={
          hasCanvas ? (
            <div
              className="relative z-10 min-w-0 border-r border-divider bg-background"
              style={{ borderRightWidth: dockInspector ? 1 : 0, gridColumn: 2, gridRow: 3 }}
            >
              <StatusBarHost>{statusContent}</StatusBarHost>
            </div>
          ) : null
        }
      />
    </TooltipProvider>
  )
}
