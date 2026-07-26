import type { EditorSession } from '@poietica/editor-core/application'
import {
  CanvasInspectorRightSidebar,
  CanvasTransformStatus,
  type EditorSessionFailure,
  EditorSessionHost,
  useCanvasInspectorAvailability,
} from '@poietica/editor-core/react'
import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import { ConfirmationDialog } from '@poietica/foundations-design-system'
import type {
  CanvasCloseIntent,
  CanvasCloseSnapshot,
  CanvasSessionSnapshot,
} from '@poietica/editor-document'
import type {
  CanvasSessionId,
  WorkbenchSessionStore,
  WorkbenchTabViewModel,
  WorkbenchTabId,
  WorkspaceShellActions,
  WorkspaceSurfaceRenderers,
} from '@poietica/features-workspace/contracts'
import {
  NoCanvasSurface,
  WorkbenchTabs,
  WorkspaceShell,
  WorkspaceSurface,
} from '@poietica/features-workspace/react'
import { type ReactNode, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { reportDocumentFatal } from '../../application/failures/document-failure-reporter'
import { failureCoordinator } from '../../application/failures/failure-coordinator'
import { DesktopTitleBar } from '../chrome/DesktopTitleBar'
import { reportFailure } from '../../application/failures/failure-policy'
import { DocumentQuarantineSurface } from './DocumentQuarantineSurface'
import { WORKSPACE_PANEL_RENDERERS } from './assistant-panel-renderers'
import { createAssistantSurfaceRenderers } from './assistant-surface-renderers'

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
  readonly agentSession: AgentSessionPort
  readonly port: WorkspaceUIPort
  readonly degradedFeatures: readonly string[]
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
  agentSession,
  port,
  degradedFeatures,
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

  const windowControlsDisabled = degradedFeatures.includes('window-controls')

  const windowDraggingDisabled = degradedFeatures.includes('window-dragging')

  const developerToolsDisabled = degradedFeatures.includes('developer-tools')

  const settingsDisabled = degradedFeatures.includes('settings')

  const workbench = useSyncExternalStore(
    port.workspace.subscribe,
    port.workspace.getSnapshot,
    port.workspace.getSnapshot,
  )

  const failureSnapshot = useSyncExternalStore(
    failureCoordinator.subscribe,
    failureCoordinator.getSnapshot,
    failureCoordinator.getSnapshot,
  )

  useEffect(() => {
    const openSessionIds = new Set(
      workbench.tabs.flatMap((tab) => (tab.kind === 'canvas' ? [tab.sessionId] : [])),
    )

    for (const sessionId of failureSnapshot.quarantinedDocuments.keys()) {
      if (openSessionIds.has(sessionId)) {
        continue
      }

      failureCoordinator.resolveScope({
        kind: 'document',
        documentId: sessionId,
      })
    }
  }, [failureSnapshot.quarantinedDocuments, workbench.tabs])

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
        reportFailure('CANVAS_SAVE_FAILED', {
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
        reportFailure('CANVAS_CLOSE_FAILED', {
          scope: 'workspace',
          operation: 'close-canvas',
          sessionId,
          cause,
        })
      })
    },
    [port.canvases],
  )

  const handleSessionFailure = useCallback((failure: EditorSessionFailure) => {
    reportDocumentFatal(failure)
  }, [])

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
            reportFailure('CANVAS_CREATE_FAILED', {
              scope: 'workspace',
              operation: 'create-canvas',
              cause,
            })
          })
      },

      openCanvas() {
        void port.canvases.open().catch((cause: unknown) => {
          reportFailure('CANVAS_OPEN_FAILED', {
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

      openDeveloperTools: developerToolsDisabled ? () => {} : onDeveloperToolsOpen,

      openSettingsWindow: settingsDisabled ? () => {} : onSettingsOpen,
    }),
    [
      activeEditorSession,
      developerToolsDisabled,
      handleCloseTab,
      onCommandPaletteOpen,
      onDeveloperToolsOpen,
      onSettingsOpen,
      pages.length,
      port.canvases,
      port.workspace,
      settingsDisabled,
      workbench.tabs,
    ],
  )

  /*
   * CanvasWorkflow may publish after any document transaction. Subscribing to
   * its monotonically increasing version forced this entire composition root
   * to render for shape movement, drawing and resizing.
   *
   * The selector below returns the previous array reference unless one of the
   * tab-visible persistence states actually changed.
   */
  const tabs = useCanvasTabs(port.canvases, workbench.tabs)

  const model = useMemo(
    () => ({
      ...workbench,
      tabs,
    }),
    [tabs, workbench],
  )

  const activeCanvasTitle = useMemo(
    () =>
      activeSessionId === null
        ? null
        : (tabs.find((tab) => tab.kind === 'canvas' && tab.sessionId === activeSessionId)?.title ??
          null),
    [activeSessionId, tabs],
  )

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

  const surfaceRenderers = useMemo(
    () => createAssistantSurfaceRenderers(agentSession),
    [agentSession],
  )

  const mainContent = renderActiveSurface({
    activeSurface: workbench.activeSurface,
    surfaceRenderers,
    activeSessionId,
    hostedSessions,
    quarantinedSessionIds: [...failureSnapshot.quarantinedDocuments.keys()],
    onCreateCanvas: actions.createCanvas,
    onOpenCanvas: actions.openCanvas,
    onSave: handleSave,
    onSessionFailure: handleSessionFailure,
    renderSessionFailure: (sessionId) => (
      <DocumentQuarantineSurface
        onClose={() => {
          handleCloseCanvas(sessionId)
        }}
        sessionId={sessionId}
      />
    ),
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
      panelRenderers={WORKSPACE_PANEL_RENDERERS}
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
          windowControlsDisabled={windowControlsDisabled}
          windowDraggingDisabled={windowDraggingDisabled}
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

function useCanvasTabs(
  canvases: WorkspaceCanvasUIPort,
  sourceTabs: readonly WorkbenchTabViewModel[],
): readonly WorkbenchTabViewModel[] {
  /*
   * React compares external-store snapshots with Object.is. The selector is
   * scoped to the current source tab array and caches its projected result.
   *
   * Canvas notifications still cause a cheap O(tab count) status check, but
   * ordinary document changes return the exact previous array reference and
   * therefore do not schedule a WorkspaceContainer render.
   */
  const getTabsSnapshot = useMemo(
    () => createCanvasTabsSnapshotReader(canvases, sourceTabs),
    [canvases, sourceTabs],
  )

  return useSyncExternalStore(canvases.subscribe, getTabsSnapshot, getTabsSnapshot)
}

function createCanvasTabsSnapshotReader(
  canvases: WorkspaceCanvasUIPort,
  sourceTabs: readonly WorkbenchTabViewModel[],
): () => readonly WorkbenchTabViewModel[] {
  type PersistenceState = CanvasSessionSnapshot['persistence'] | undefined

  let cachedStatuses: ReadonlyMap<CanvasSessionId, PersistenceState> | null = null

  let cachedTabs: readonly WorkbenchTabViewModel[] | null = null

  return () => {
    const nextStatuses = new Map<CanvasSessionId, PersistenceState>()

    for (const tab of sourceTabs) {
      if (tab.kind !== 'canvas') {
        continue
      }

      nextStatuses.set(tab.sessionId, canvases.getSessionSnapshot(tab.sessionId)?.persistence)
    }

    if (cachedStatuses && cachedTabs && persistenceStatesEqual(cachedStatuses, nextStatuses)) {
      return cachedTabs
    }

    cachedStatuses = nextStatuses
    cachedTabs = sourceTabs.map((tab) => {
      if (tab.kind !== 'canvas') {
        return tab
      }

      const status = nextStatuses.get(tab.sessionId)

      return status ? { ...tab, status } : tab
    })

    return cachedTabs
  }
}

function persistenceStatesEqual(
  previous: ReadonlyMap<CanvasSessionId, CanvasSessionSnapshot['persistence'] | undefined>,
  next: ReadonlyMap<CanvasSessionId, CanvasSessionSnapshot['persistence'] | undefined>,
): boolean {
  if (previous.size !== next.size) {
    return false
  }

  for (const [sessionId, status] of previous) {
    if (!next.has(sessionId) || next.get(sessionId) !== status) {
      return false
    }
  }

  return true
}

interface ActiveSurfaceRendererProps {
  readonly activeSurface: import('@poietica/features-workspace/contracts').WorkbenchSurfaceViewModel
  readonly activeSessionId: CanvasSessionId | null
  readonly hostedSessions: readonly {
    readonly sessionId: CanvasSessionId
    readonly session: EditorSession
  }[]
  readonly quarantinedSessionIds: readonly string[]
  readonly onCreateCanvas: () => void
  readonly onOpenCanvas: () => void
  readonly onSave: (sessionId: CanvasSessionId) => void
  readonly onSessionFailure: (failure: EditorSessionFailure) => void
  readonly renderSessionFailure: (sessionId: string) => ReactNode
  readonly surfaceRenderers: WorkspaceSurfaceRenderers
}

function renderActiveSurface({
  activeSurface,
  activeSessionId,
  hostedSessions,
  quarantinedSessionIds,
  onCreateCanvas,
  onOpenCanvas,
  onSave,
  onSessionFailure,
  renderSessionFailure,
  surfaceRenderers,
}: ActiveSurfaceRendererProps) {
  switch (activeSurface.kind) {
    case 'start':
      return <NoCanvasSurface onCreateDocument={onCreateCanvas} onOpenDocument={onOpenCanvas} />

    case 'workspace':
      return <WorkspaceSurface renderers={surfaceRenderers} surfaceId={activeSurface.surfaceId} />

    case 'canvas':
      return (
        <EditorSessionHost
          activeSessionId={activeSessionId}
          onSave={onSave}
          onSessionFailure={onSessionFailure}
          quarantinedSessionIds={quarantinedSessionIds}
          renderSessionFailure={renderSessionFailure}
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
