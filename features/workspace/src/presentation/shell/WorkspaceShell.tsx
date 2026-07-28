import type { WorkspaceShellProps } from '@poietica/agent-protocol'
import type { WorkbenchSurfaceViewModel } from '@poietica/features-workspace/contracts'
import { TooltipProvider } from '@poietica/foundations-design-system'
import { InspectorHost } from '../inspector/InspectorHost'
import { StatusBarHost } from '../status/StatusBarHost'
import { InspectorRegion } from './InspectorRegion'
import { SidebarRegion } from './SidebarRegion'
import {
  CANVAS_START_NAV_ID,
  describeWorkspaceSurface,
  type WorkspaceNavigationId,
} from './surface-registry'
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

  const activeNavigationId = resolveNavigationId(model.activeSurface)

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
          /*
           * 这条横线属于 chrome 行本身：它是栅格里 chrome 与内容的边界，与行内
           * 装的是标签条还是设置界面无关。此前由标题栏内部的三个分区各画一截，
           * 设置模式下标签条不渲染，中段随之消失。
           */
          <header className="workspace-shell__chrome min-h-0 min-w-0 border-b border-divider bg-chrome">
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
                activeNavigationId={activeNavigationId}
                onCanvasStartActivate={() => {
                  actions.openCanvasStart()
                  setSidebarOpen(true)
                }}
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

/**
 * 当前高亮的导航项。
 *
 * switch 穷尽三种表面形态，没有兜底值：画布态返回 null，因为画布是文档而不是
 * 导航目的地，此时任何导航项都不该亮。此前这里在非工作区表面时兜底成 'pages'，
 * 于是打开画布之后侧栏仍然亮着「画布」——一个兜底常量造成的假状态。
 */
function resolveNavigationId(surface: WorkbenchSurfaceViewModel): WorkspaceNavigationId | null {
  /*
   * 对话不是导航目的地。
   *
   * 「新建对话」是入口——按下去开一条新会话，它自己不驻留；一条已有会话
   * 是目的地，高亮属于左侧会话列表里的那一行。此前这里返回 'ai'，于是停在
   * 某条会话上时「新建对话」也亮着，两处同时高亮就是这么来的。
   */
  if (surface.kind === 'conversation') {
    return null
  }

  switch (surface.kind) {
    case 'workspace':
      return surface.surfaceId

    case 'start':
      return CANVAS_START_NAV_ID

    case 'canvas':
      return null
  }
}
