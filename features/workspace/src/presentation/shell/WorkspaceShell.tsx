import { TooltipProvider } from '@poietica/foundations-design-system'

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

/**
 * 工作区外壳。
 *
 * 职责只有一件事：把布局意图翻译成三个状态位，并把各区域装进 WorkspaceFrame。
 * 栅格坐标属于 workspace-shell.css，区域内部形态（停靠列 / 模态抽屉 / 开合
 * 控件）属于区域组件自己，拖拽态属于 workspaceLayoutStore。
 */
export function WorkspaceShell({
  model,
  sidebarPanel,
  sidebarOverride,
  mainContentLabel,
  actions,
  renderChrome,
  mainContent,
  inspector,
  inspectorAvailable,
  statusContent,
  assistantOverlay,
  overlays,
}: WorkspaceShellProps) {
  const mode = useWorkspaceLayoutMode()

  const { sidebarOpen, sidebarWidth, inspectorOpen, isResizing } = useWorkspaceLayoutState()

  const { setSidebarOpen, setSidebarWidth, setInspectorOpen } = workspaceLayoutStore

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
            className="workspace-shell__canvas relative z-10 min-h-0 min-w-0 overflow-hidden border-r border-divider bg-background"
          >
            <main
              aria-label={mainContentLabel}
              aria-labelledby={
                mainContentLabel === undefined ? `workbench-tab-${activeTabDomId}` : undefined
              }
              className="relative h-full min-h-0 min-w-0 overflow-hidden"
              id={mainContentLabel === undefined ? `workbench-panel-${activeTabDomId}` : undefined}
              role={mainContentLabel === undefined ? 'tabpanel' : 'region'}
            >
              {mainContent}
            </main>
          </section>
        }
        chrome={
          <header className="workspace-shell__chrome min-h-0 min-w-0 bg-chrome">
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
        hasStatusBar={hasCanvas}
        inspector={
          hasCanvas && inspectorAvailable ? (
            <InspectorRegion isDocked={dockInspector} onOpenChange={setInspectorOpen}>
              <InspectorHost>{inspector}</InspectorHost>
            </InspectorRegion>
          ) : null
        }
        inspectorColumnWidth={dockInspector ? WORKSPACE_LAYOUT.inspector.width : 0}
        isInspectorDocked={dockInspector}
        isSidebarDocked={dockSidebar}
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
            width={sidebarWidth}
          >
            {sidebarOverride ?? (
              <WorkspaceSidebar
                activeSurfaceId={activeSurfaceId}
                onCreateConversation={() => {
                  actions.openWorkspaceSurface('ai', describeWorkspaceSurface('ai').title)
                  setSidebarOpen(true)
                }}
                onDeveloperToolsOpen={actions.openDeveloperTools}
                onSettingsOpen={actions.openSettingsWindow}
                onSurfaceActivate={(surfaceId) => {
                  actions.openWorkspaceSurface(surfaceId, describeWorkspaceSurface(surfaceId).title)
                  setSidebarOpen(true)
                }}
                panel={sidebarPanel}
              />
            )}
          </SidebarRegion>
        }
        sidebarColumnWidth={dockSidebar ? sidebarWidth : 0}
        statusBar={
          hasCanvas ? (
            <div className="workspace-shell__status relative z-10 min-w-0 border-r border-divider bg-background">
              <StatusBarHost>{statusContent}</StatusBarHost>
            </div>
          ) : null
        }
      />
    </TooltipProvider>
  )
}
