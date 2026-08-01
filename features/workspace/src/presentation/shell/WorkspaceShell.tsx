import type {
  WorkbenchSurfaceViewModel,
  WorkspaceSurfaceId,
} from '@poietica/features-workspace/contracts'
import { TooltipProvider } from '@poietica/foundations-design-system'
import type { WorkspaceShellProps } from '../../contracts/shell-contract'
import { SidebarRegion } from './SidebarRegion'
import { describeWorkspaceSurface } from './surface-registry'
import { useWorkspaceLayoutMode } from './useWorkspaceLayout'
import { WorkspaceFrame } from './WorkspaceFrame'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { encodeWorkbenchTabDomId } from './workbench-tabs/workbench-tabs-model'
import { useWorkspaceLayoutState, workspaceLayoutStore } from './workspace-layout-store'

/**
 * 工作区外壳。
 *
 * 职责只有一件事：把布局意图翻译成停靠状态位，并把各区域装进 WorkspaceFrame。
 * 栅格坐标属于 workspace-shell.css，区域内部形态（停靠列 / 模态抽屉 / 开合
 * 控件）属于区域组件自己，拖拽态属于 workspaceLayoutStore。
 */
export function WorkspaceShell({
  model,
  sidebarPanel,
  sidebarFooterSlot,
  sidebarOverride,
  mainContentLabel,
  actions,
  renderChrome,
  mainContent,
  assistantOverlay,
  overlays,
}: WorkspaceShellProps) {
  const mode = useWorkspaceLayoutMode()

  const { sidebarOpen, sidebarWidth, isResizing } = useWorkspaceLayoutState()

  const { setSidebarOpen, setSidebarWidth } = workspaceLayoutStore

  /*
   * 「新建对话」是同一个入口的三个按钮共用的那一次派生：标签条的加号、
   * 侧栏导航的那一行、会话列表的加号。侧栏那两处额外把侧栏展开，因为它们
   * 本来就在侧栏里，标签条上的加号不该动侧栏。
   */
  const openConversationEntry = () => {
    actions.openWorkspaceSurface('ai', describeWorkspaceSurface('ai').title)
  }

  const activeNavigationId = resolveNavigationId(model.activeSurface)

  const dockSidebar = mode !== 'narrow' && sidebarOpen

  const activeTabDomId = encodeWorkbenchTabDomId(model.activeTabId)

  return (
    <TooltipProvider delayDuration={450}>
      <WorkspaceFrame
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
              onCreateConversation: openConversationEntry,
            })}
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
                footerLeading={sidebarFooterSlot}
                onCreateConversation={() => {
                  openConversationEntry()
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
      />
    </TooltipProvider>
  )
}

/**
 * 当前高亮的导航项。
 *
 * 对话不是导航目的地：「新建对话」是入口——按下去开一条新会话，它自己不
 * 驻留；一条已有会话是目的地，高亮属于左侧会话列表里的那一行。此前这里返回
 * 'ai'，于是停在某条会话上时「新建对话」也亮着，两处同时高亮就是这么来的。
 */
function resolveNavigationId(surface: WorkbenchSurfaceViewModel): WorkspaceSurfaceId | null {
  return surface.kind === 'workspace' ? surface.surfaceId : null
}
