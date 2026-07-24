import { Button, TooltipProvider } from '@hybrid-canvas/design-system'
import { PanelLeftClose, PanelRightClose, PanelRightOpen } from '@mynaui/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { WorkspaceShellProps } from '../../contracts/shell-contract'
import type { WorkspaceSurfaceId } from '../../contracts/workbench-contract'
import { InspectorHost } from '../inspector/InspectorHost'
import { StatusBarHost } from '../status/StatusBarHost'
import { ActivityRail } from './ActivityRail'
import { SidebarSplitter } from './SidebarSplitter'
import { useWorkspaceLayoutMode } from './useWorkspaceLayout'
import { WorkspaceFrame } from './WorkspaceFrame'
import { WorkspaceSidebar } from './WorkspaceSidebar'

import './workspace-shell.css'

const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 280
const INSPECTOR_WIDTH = 276

const SURFACE_TITLES: Record<WorkspaceSurfaceId, string> = {
  pages: '画布',
  documents: '恢复',
  search: '搜索',
  layers: '图层',
  relations: '关系',
  data: '自动化',
  assets: '素材',
  extensions: '插件',
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 工作区外壳集中编排响应式区域及其条件渲染
export function WorkspaceShell({
  model,
  actions,
  pages,
  renderChrome,
  mainContent,
  inspector,
  inspectorAvailable,
  statusContent,
  assistantOverlay,
  overlays,
}: WorkspaceShellProps) {
  const mode = useWorkspaceLayoutMode()
  const previousModeRef = useRef(mode)

  const [isSidebarOpen, setSidebarOpen] = useState(true)
  const [isInspectorOpen, setInspectorOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [isResizing, setResizing] = useState(false)

  const activeNavigationItem: WorkspaceSurfaceId =
    model.activeSurface.kind === 'workspace' ? model.activeSurface.surfaceId : 'pages'

  const hasCanvas = model.activeSurface.kind === 'canvas'
  const dockSidebar = mode !== 'narrow' && isSidebarOpen
  const dockInspector = inspectorAvailable && isInspectorOpen && hasCanvas

  useEffect(() => {
    const previousMode = previousModeRef.current

    if (previousMode === mode) {
      return
    }

    previousModeRef.current = mode

    if (mode === 'narrow') {
      setSidebarOpen(false)
    }
  }, [mode])

  const openSidebar = () => {
    if (mode === 'narrow') {
      setInspectorOpen(false)
    }

    setSidebarOpen(true)
  }

  const sidebarColumnWidth = dockSidebar ? sidebarWidth : 0
  const inspectorColumnWidth = dockInspector ? INSPECTOR_WIDTH : 0

  const columns = useMemo(
    () =>
      [
        'var(--activity-rail-width)',
        'var(--workspace-sidebar-column-width, 0px)',
        'minmax(0, 1fr)',
        'var(--workspace-inspector-column-width, 0px)',
      ].join(' '),
    [],
  )

  const rows = hasCanvas
    ? ['var(--chrome-height)', 'minmax(0, 1fr)', 'var(--status-height)'].join(' ')
    : ['var(--chrome-height)', 'minmax(0, 1fr)'].join(' ')

  const sidebarContent = (
    <WorkspaceSidebar
      activeNavigationItem={activeNavigationItem}
      onActivatePage={actions.activatePage}
      onCreatePage={actions.createPage}
      pages={pages}
    />
  )

  const chrome = (
    <header className="col-span-full row-1 min-h-0 min-w-0 bg-chrome">
      {renderChrome({
        isSidebarOpen,
        sidebarWidth: dockSidebar ? sidebarWidth : 0,
        tabs: model.tabs,
        onSidebarToggle: () => {
          if (isSidebarOpen) {
            setSidebarOpen(false)
          } else {
            openSidebar()
          }
        },
        onActivateTab: actions.activateTab,
        onCloseTab: actions.closeTab,
        onMoveTab: actions.moveTab,
        onCreateCanvas: actions.createCanvas,
      })}
    </header>
  )

  const rail = (
    <div
      className="row-[2/-1] min-h-0 border-r border-divider bg-sidebar"
      style={{ gridColumn: 1 }}
    >
      <ActivityRail
        activeItemId={activeNavigationItem}
        onDeveloperToolsOpen={actions.openDeveloperTools}
        onItemActivate={(surfaceId) => {
          actions.openWorkspaceSurface(surfaceId, SURFACE_TITLES[surfaceId])
          openSidebar()
        }}
        onSettingsOpen={actions.openSettingsWindow}
      />
    </div>
  )

  const sidebar = (
    <>
      <div
        aria-hidden={!dockSidebar}
        className="relative z-20 row-[2/-1] min-h-0 min-w-0 overflow-visible border-r border-divider bg-sidebar"
        style={{
          borderRightWidth: dockSidebar ? 1 : 0,
          gridColumn: 2,
          pointerEvents: dockSidebar ? 'auto' : 'none',
        }}
      >
        {mode !== 'narrow' ? (
          <div className="h-full min-h-0 w-full overflow-hidden">
            <div className="h-full min-h-0" style={{ width: sidebarWidth }}>
              {sidebarContent}
            </div>
          </div>
        ) : null}

        {dockSidebar ? (
          <SidebarSplitter
            max={SIDEBAR_MAX}
            min={SIDEBAR_MIN}
            onCollapse={() => setSidebarOpen(false)}
            onResize={setSidebarWidth}
            onResizeEnd={() => setResizing(false)}
            onResizeStart={() => setResizing(true)}
            width={sidebarWidth}
          />
        ) : null}
      </div>

      {mode === 'narrow' && isSidebarOpen ? (
        <div className="fixed inset-x-0 bottom-0 top-[var(--chrome-height)] z-[var(--ui-z-popover)]">
          <button
            aria-label="关闭工作区导航"
            className="absolute inset-0 cursor-default bg-black/35"
            onClick={() => setSidebarOpen(false)}
            type="button"
          />

          <aside
            aria-label="工作区导航"
            className="relative ml-[var(--activity-rail-width)] h-full w-[min(82vw,320px)] border-r border-divider bg-sidebar shadow-2xl"
          >
            <div className="relative h-full">
              {sidebarContent}

              <Button
                aria-label="关闭侧边栏"
                className="absolute right-2 top-2"
                onClick={() => setSidebarOpen(false)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <PanelLeftClose aria-hidden="true" className="size-4" />
              </Button>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  )

  const canvas = (
    <section
      aria-label="内容区"
      className="relative z-10 row-2 min-h-0 min-w-0 overflow-hidden border-r border-divider bg-background"
      style={{
        borderRightWidth: dockInspector ? 1 : 0,
        gridColumn: 3,
      }}
    >
      <main
        aria-labelledby={`workbench-tab-${model.activeTabId.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`}
        className="relative h-full min-h-0 min-w-0 overflow-hidden"
        id={`workbench-panel-${model.activeTabId.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`}
        role="tabpanel"
      >
        {mainContent}
      </main>
    </section>
  )

  const inspectorContent = <InspectorHost>{inspector}</InspectorHost>

  const inspectorRegion =
    hasCanvas && inspectorAvailable ? (
      <>
        <aside
          aria-hidden={!dockInspector}
          aria-label="属性检查器"
          className="relative row-[2/-1] min-h-0 min-w-0 overflow-visible"
          style={{
            gridColumn: 4,
            pointerEvents: dockInspector ? 'auto' : 'none',
          }}
        >
          {dockInspector ? (
            <div
              className="absolute inset-y-0 right-0 overflow-visible"
              style={{ width: INSPECTOR_WIDTH }}
            >
              <div className="relative h-full">
                <Button
                  aria-label="收起属性面板"
                  className="absolute -left-8 top-3 z-30 size-7 rounded-r-none"
                  onClick={() => setInspectorOpen(false)}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <PanelRightClose aria-hidden="true" className="size-3.5" />
                </Button>

                {inspectorContent}
              </div>
            </div>
          ) : null}
        </aside>

        {!dockInspector ? (
          <Button
            aria-expanded={false}
            aria-label="展开属性面板"
            className="fixed right-0 top-[calc(var(--chrome-height)+12px)] z-30 rounded-r-none"
            onClick={() => {
              if (mode !== 'wide') {
                setSidebarOpen(false)
              }

              setInspectorOpen(true)
            }}
            size="icon"
            type="button"
            variant="outline"
          >
            <PanelRightOpen aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
      </>
    ) : null

  const status = hasCanvas ? (
    <div
      className="relative z-10 min-w-0 border-r border-divider bg-background"
      style={{
        borderRightWidth: dockInspector ? 1 : 0,
        gridColumn: 3,
        gridRow: 3,
      }}
    >
      <StatusBarHost>{statusContent}</StatusBarHost>
    </div>
  ) : null

  return (
    <TooltipProvider delayDuration={450}>
      <WorkspaceFrame
        canvas={canvas}
        chrome={chrome}
        disableLayoutAnimation={isResizing}
        gridTemplateColumns={columns}
        gridTemplateRows={rows}
        inspector={inspectorRegion}
        inspectorColumnWidth={inspectorColumnWidth}
        overlays={
          <>
            {assistantOverlay}
            {overlays}
          </>
        }
        rail={rail}
        sidebar={sidebar}
        sidebarColumnWidth={sidebarColumnWidth}
        statusBar={status}
      />
    </TooltipProvider>
  )
}
