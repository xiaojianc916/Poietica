import type { EditorSession } from '@hybrid-canvas/canvas/application'
import {
  CanvasInspectorRightSidebar,
  CanvasTransformStatus,
  EditorSessionHost,
  useCanvasInspectorAvailability,
} from '@hybrid-canvas/canvas/react'
import { ConfirmationDialog } from '@hybrid-canvas/design-system'
import type {
  CanvasCloseIntent,
  CanvasCloseSnapshot,
  CanvasSessionSnapshot,
} from '@hybrid-canvas/document'
import type {
  CanvasSessionId,
  WorkbenchSessionStore,
  WorkbenchTabId,
  WorkspaceShellActions,
} from '@hybrid-canvas/workspace/contracts'
import {
  NoCanvasSurface,
  WorkbenchTabs,
  WorkspaceShell,
  WorkspaceSurface,
} from '@hybrid-canvas/workspace/react'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { DesktopTitleBar } from '../chrome/DesktopTitleBar'
import { reportUiError as reportError } from '../ui/ui-feedback'

const EMPTY_EDITOR_SESSION_SNAPSHOT = Object.freeze({
  pages: Object.freeze([]),
})

const EMPTY_SUBSCRIBE = () => () => {}
const EMPTY_EDITOR_SNAPSHOT = () => EMPTY_EDITOR_SESSION_SNAPSHOT

export interface WorkspaceCanvasUIPort {
  readonly create: (title: string) => Promise<void>
  readonly open: () => Promise<void>
  readonly save: (sessionId: CanvasSessionId) => Promise<void>
  readonly closeCanvas: (sessionId: CanvasSessionId, intent: CanvasCloseIntent) => Promise<void>
  readonly cancelCanvasClose: (sessionId: CanvasSessionId) => void
  readonly getCloseSnapshot: () => CanvasCloseSnapshot
  readonly getEditorSession: (sessionId: CanvasSessionId) => EditorSession | null
  readonly getSessionSnapshot: (sessionId: CanvasSessionId) => CanvasSessionSnapshot | null
  readonly getVersion: () => number
  readonly subscribe: (listener: () => void) => () => void
}

export interface WorkspaceUIPort {
  readonly canvases: WorkspaceCanvasUIPort
  readonly workspace: WorkbenchSessionStore
}

export interface WorkspaceContainerProps {
  readonly port: WorkspaceUIPort
  readonly isWindowMaximized: boolean
  readonly onCommandPaletteOpen: () => void
  readonly onDeveloperToolsOpen: () => void
  readonly onSettingsOpen: () => void
  readonly onWindowMinimize: () => void
  readonly onWindowMaximize: () => void
  readonly onWindowClose: () => void
  readonly onWindowStartDragging: () => void
}

export function WorkspaceContainer({
  port,
  isWindowMaximized,
  onCommandPaletteOpen,
  onDeveloperToolsOpen,
  onSettingsOpen,
  onWindowMinimize,
  onWindowMaximize,
  onWindowClose,
  onWindowStartDragging,
}: WorkspaceContainerProps) {
  const inspectorAvailable = useCanvasInspectorAvailability()

  const workbench = useSyncExternalStore(
    port.workspace.subscribe,
    port.workspace.getSnapshot,
    port.workspace.getSnapshot,
  )

  useSyncExternalStore(port.canvases.subscribe, port.canvases.getVersion, port.canvases.getVersion)

  const closeSnapshot = useSyncExternalStore(
    port.canvases.subscribe,
    port.canvases.getCloseSnapshot,
    port.canvases.getCloseSnapshot,
  )

  const confirmationClose = Object.entries(closeSnapshot.states).find(
    ([, state]) => state.state === 'confirmation-required',
  )

  const failedClose = Object.entries(closeSnapshot.states).find(
    ([, state]) => state.state === 'release-failed',
  )

  const activeSessionId =
    workbench.activeSurface.kind === 'canvas' ? workbench.activeSurface.sessionId : null

  const activeEditorSession = activeSessionId
    ? port.canvases.getEditorSession(activeSessionId)
    : null

  const pages = useSyncExternalStore(
    activeEditorSession?.subscribe ?? EMPTY_SUBSCRIBE,
    activeEditorSession?.getSessionSnapshot ?? EMPTY_EDITOR_SNAPSHOT,
    activeEditorSession?.getSessionSnapshot ?? EMPTY_EDITOR_SNAPSHOT,
  ).pages

  const handleSave = useCallback(
    (sessionId: CanvasSessionId) => {
      void port.canvases.save(sessionId).catch((cause: unknown) => {
        reportError('canvas save failed', {
          scope: 'workspace',
          operation: 'save-canvas',
          sessionId,
          cause,
        })
      })
    },
    [port.canvases],
  )

  const handleCloseCanvas = useCallback(
    (sessionId: CanvasSessionId, intent: CanvasCloseIntent = 'normal') => {
      void port.canvases.closeCanvas(sessionId, intent).catch((cause: unknown) => {
        reportError('canvas close transaction failed', {
          scope: 'workspace',
          operation: 'close-canvas',
          sessionId,
          cause,
        })
      })
    },
    [port.canvases],
  )

  const handleCloseTab = useCallback(
    (tabId: WorkbenchTabId) => {
      const tab = port.workspace.getSnapshot().tabs.find((candidate) => candidate.id === tabId)

      if (!tab?.canClose) {
        return
      }

      if (tab.kind === 'canvas') {
        handleCloseCanvas(tab.sessionId)
        return
      }

      port.workspace.closeTab(tab.id)
    },
    [handleCloseCanvas, port.workspace],
  )

  const actions = useMemo<WorkspaceShellActions>(
    () => ({
      createCanvas() {
        const existingTitles = workbench.tabs
          .filter((tab) => tab.kind === 'canvas')
          .map((tab) => tab.title)

        void port.canvases
          .create(createUntitledCanvasTitle(existingTitles))
          .catch((cause: unknown) => {
            reportError('canvas create failed', {
              scope: 'workspace',
              operation: 'create-canvas',
              cause,
            })
          })
      },

      openCanvas() {
        void port.canvases.open().catch((cause: unknown) => {
          reportError('canvas open failed', {
            scope: 'workspace',
            operation: 'open-canvas',
            cause,
          })
        })
      },

      activateTab(tabId) {
        port.workspace.activateTab(tabId)
      },

      closeTab: handleCloseTab,

      moveTab(tabId, targetIndex) {
        port.workspace.moveTab(tabId, targetIndex)
      },

      openWorkspaceSurface(surfaceId, title) {
        port.workspace.openWorkspaceSurface({
          surfaceId,
          title,
        })
      },

      activatePage(pageId) {
        activeEditorSession?.activatePage(pageId)
      },

      createPage() {
        activeEditorSession?.createPage(`画布 ${String(pages.length + 1)}`)
      },

      openCommandPalette: onCommandPaletteOpen,
      openDeveloperTools: onDeveloperToolsOpen,
      openSettingsWindow: onSettingsOpen,
    }),
    [
      activeEditorSession,
      handleCloseTab,
      onCommandPaletteOpen,
      onDeveloperToolsOpen,
      onSettingsOpen,
      pages.length,
      port.canvases,
      port.workspace,
      workbench.tabs,
    ],
  )

  const tabs = workbench.tabs.map((tab) => {
    if (tab.kind !== 'canvas') {
      return tab
    }

    const status = port.canvases.getSessionSnapshot(tab.sessionId)?.persistence

    return status ? { ...tab, status } : tab
  })

  const model = {
    ...workbench,
    tabs,
  }

  const activeCanvasTitle =
    activeSessionId === null
      ? null
      : (tabs.find((tab) => tab.kind === 'canvas' && tab.sessionId === activeSessionId)?.title ??
        null)

  const hostedSessions = useMemo(
    () =>
      workbench.tabs.flatMap((tab) => {
        if (tab.kind !== 'canvas') {
          return []
        }

        const session = port.canvases.getEditorSession(tab.sessionId)

        return session ? [{ sessionId: tab.sessionId, session }] : []
      }),
    [port.canvases, workbench.tabs],
  )

  const mainContent = renderActiveSurface({
    activeSurface: workbench.activeSurface,
    activeSessionId,
    hostedSessions,
    onCreateCanvas: actions.createCanvas,
    onOpenCanvas: actions.openCanvas,
    onSave: handleSave,
  })

  return (
    <WorkspaceShell
      actions={actions}
      inspector={<CanvasInspectorRightSidebar />}
      inspectorAvailable={inspectorAvailable}
      mainContent={mainContent}
      model={model}
      overlays={
        <>
          <ConfirmationDialog
            confirmLabel="放弃并关闭"
            description="关闭画布会丢失自上次保存后的更改，此操作无法撤销。"
            destructive
            onCancel={() => {
              if (confirmationClose) {
                port.canvases.cancelCanvasClose(confirmationClose[0])
              }
            }}
            onConfirm={() => {
              if (confirmationClose) {
                handleCloseCanvas(confirmationClose[0], 'discard')
              }
            }}
            open={confirmationClose !== undefined}
            title="放弃未保存的更改？"
          />

          <ConfirmationDialog
            cancelLabel="保留画布"
            confirmLabel="重试关闭"
            description="无法释放本地文档会话。画布仍保持打开状态，您可以重试关闭。"
            onCancel={() => {
              if (failedClose) {
                port.canvases.cancelCanvasClose(failedClose[0])
              }
            }}
            onConfirm={() => {
              if (failedClose && failedClose[1].state === 'release-failed') {
                handleCloseCanvas(failedClose[0], failedClose[1].intent)
              }
            }}
            open={failedClose !== undefined}
            title="关闭画布失败"
          />
        </>
      }
      pages={pages}
      renderChrome={({
        isSidebarOpen,
        sidebarWidth,
        tabs: chromeTabs,
        onSidebarToggle,
        onActivateTab,
        onCloseTab,
        onMoveTab,
        onCreateCanvas,
      }) => (
        <DesktopTitleBar
          isMaximized={isWindowMaximized}
          isSidebarOpen={isSidebarOpen}
          onClose={onWindowClose}
          onMaximize={onWindowMaximize}
          onMinimize={onWindowMinimize}
          onSidebarToggle={onSidebarToggle}
          onStartDragging={onWindowStartDragging}
          sidebarWidth={sidebarWidth}
        >
          <WorkbenchTabs
            onActivate={onActivateTab}
            onClose={onCloseTab}
            onCreate={onCreateCanvas}
            onMove={onMoveTab}
            tabs={chromeTabs}
          />
        </DesktopTitleBar>
      )}
      statusContent={<CanvasTransformStatus canvasTitle={activeCanvasTitle} />}
    />
  )
}

interface ActiveSurfaceRendererProps {
  readonly activeSurface: import('@hybrid-canvas/workspace/contracts').WorkbenchSurfaceViewModel
  readonly activeSessionId: CanvasSessionId | null
  readonly hostedSessions: readonly {
    readonly sessionId: CanvasSessionId
    readonly session: EditorSession
  }[]
  readonly onCreateCanvas: () => void
  readonly onOpenCanvas: () => void
  readonly onSave: (sessionId: CanvasSessionId) => void
}

function renderActiveSurface({
  activeSurface,
  activeSessionId,
  hostedSessions,
  onCreateCanvas,
  onOpenCanvas,
  onSave,
}: ActiveSurfaceRendererProps) {
  switch (activeSurface.kind) {
    case 'start':
      return <NoCanvasSurface onCreateDocument={onCreateCanvas} onOpenDocument={onOpenCanvas} />

    case 'workspace':
      return <WorkspaceSurface surfaceId={activeSurface.surfaceId} />

    case 'canvas':
      return (
        <EditorSessionHost
          activeSessionId={activeSessionId}
          onSave={onSave}
          sessions={hostedSessions}
        />
      )
  }
}

function createUntitledCanvasTitle(existingTitles: readonly string[]): string {
  const baseTitle = '未命名画布'

  if (!existingTitles.includes(baseTitle)) {
    return baseTitle
  }

  let suffix = 2

  while (existingTitles.includes(`${baseTitle} ${String(suffix)}`)) {
    suffix += 1
  }

  return `${baseTitle} ${String(suffix)}`
}
