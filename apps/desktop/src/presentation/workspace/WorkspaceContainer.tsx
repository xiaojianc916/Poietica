import type { AgentSessionPort } from '@poietica/agent-protocol'
import type { EditorSession } from '@poietica/editor-core/application'
import {
  CanvasInspectorRightSidebar,
  CanvasTransformStatus,
  type EditorSessionFailure,
  EditorSessionHost,
  useCanvasInspectorAvailability,
} from '@poietica/editor-core/react'
import type { CanvasCloseIntent, CanvasCloseSnapshot } from '@poietica/editor-document'
import type { AgentConfigStore, SettingsStore } from '@poietica/features-settings'
import {
  SettingsContentRegion,
  SettingsNavigationRegion,
  SettingsProvider,
} from '@poietica/features-settings/react'
import {
  type CanvasSessionId,
  CONVERSATION_ENTRY_TITLE,
  type WorkbenchSessionStore,
  type WorkbenchTabId,
  type WorkbenchTabViewModel,
  type WorkspaceShellActions,
  type WorkspaceSurfaceRenderers,
} from '@poietica/features-workspace/contracts'
import {
  nextUntitledCanvasTitle,
  SidebarFooter,
  WorkbenchTabs,
  WorkspaceShell,
  WorkspaceSurface,
} from '@poietica/features-workspace/react'
import { ConfirmationDialog } from '@poietica/foundations-design-system'
import { type ReactNode, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { reportDocumentFatal } from '../../application/failures/document-failure-reporter'
import { failureCoordinator } from '../../application/failures/failure-coordinator'
import { reportFailure } from '../../application/failures/failure-policy'
import { type ActiveTabSequence, DesktopTitleBar } from '../chrome/DesktopTitleBar'
import { AssistantSidebarPanel } from './AssistantSidebarPanel'
import { createAssistantWiring } from './assistant-wiring'
import { DocumentQuarantineSurface } from './DocumentQuarantineSurface'

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
  readonly subscribe: (listener: () => void) => () => void
}

/**
 * 运行期能力开关。
 *
 * 降级判断由 AppShell 从 failureCoordinator 派生一次，向下作为稳定引用传递；
 * UI 只把它映射成控件的 disabled，不在事件处理器里重复守卫——控件禁用之后
 * onClick 不会触发，那层守卫是死代码。
 */
export interface AppCapabilities {
  readonly settings: boolean
  readonly developerTools: boolean
  readonly windowControls: boolean
}

export interface WorkspaceUIPort {
  readonly canvases: WorkspaceCanvasUIPort
  readonly workspace: WorkbenchSessionStore
}

export interface WorkspaceContainerProps {
  readonly agentSession: AgentSessionPort
  readonly port: WorkspaceUIPort
  readonly capabilities: AppCapabilities
  readonly isSettingsOpen: boolean
  readonly onSettingsClose: () => void
  readonly settingsStore: SettingsStore
  readonly agentConfigStore: AgentConfigStore
  readonly isWindowMaximized: boolean
  readonly onCommandPaletteOpen: () => void
  readonly onDeveloperToolsOpen: () => void
  readonly onSettingsOpen: () => void
  readonly onWindowMinimize: () => void
  readonly onWindowMaximize: () => void
  readonly onWindowClose: () => void
}

export function WorkspaceContainer({
  agentSession,
  port,
  capabilities,
  isSettingsOpen,
  onSettingsClose,
  settingsStore,
  agentConfigStore,
  isWindowMaximized,
  onCommandPaletteOpen,
  onDeveloperToolsOpen,
  onSettingsOpen,
  onWindowMinimize,
  onWindowMaximize,
  onWindowClose,
}: WorkspaceContainerProps) {
  const inspectorAvailable = useCanvasInspectorAvailability()

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
        void port.canvases
          .create(nextUntitledCanvasTitle(workbench.tabs))
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

  /*
   * 标签已经带着保存状态到达：状态由工作台 store 投影，读侧不再有装饰层。
   *
   * 标题也直接取 activeCanvas —— projectSurface 早就把 title 放进去了，
   * 原先那次 useMemo 加 find 是在重算一份算好的值。
   */
  const activeCanvasTitle = workbench.activeCanvas?.title ?? null

  /* 侧栏高亮的那一行就是正在看的那一格：身份来自工作台，没有第二份状态。 */
  const activeConversationId =
    workbench.activeSurface.kind === 'conversation' ? workbench.activeSurface.threadId : null

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

  /*
   * 一条对话开口说话的那一刻，AI 那一格就变成这条对话。
   *
   * openConversation 会就地顶掉 workspace:ai（会话槽本来的规则），于是标签
   * 标题变成这句话、activeSurface 变成 conversation，左侧高亮也随之落到列表
   * 的那一行——三件事同一个来源，不需要各自同步。
   */
  const startConversation = useCallback(
    (threadId: string, title: string) => {
      port.workspace.openConversation({ threadId, title })
    },
    [port.workspace],
  )

  /*
   * 侧栏那三根线也钉住标识。
   *
   * 它们此前是 JSX 里的内联箭头，于是画布保存、标签切换、文档隔离——任何一件
   * 与 AI 无关的事让这个组件重渲，整张会话列表都要跟着重画一遍。
   *
   * 打开一条对话与「说出第一句话」是同一件事，共用 startConversation。
   */
  const openAssistantEntry = useCallback(() => {
    port.workspace.openWorkspaceSurface({ surfaceId: 'ai', title: CONVERSATION_ENTRY_TITLE })
  }, [port.workspace])

  const openConversationInNewTab = useCallback(
    (threadId: string, title: string) => {
      port.workspace.openConversationInNewTab({ threadId, title })
    },
    [port.workspace],
  )

  const assistant = useMemo(
    () => createAssistantWiring(agentSession, startConversation),
    [agentSession, startConversation],
  )

  const mainContent = renderActiveSurface({
    activeSurface: workbench.activeSurface,
    surfaceRenderers: assistant.surfaces,
    renderConversation: assistant.renderConversation,
    activeSessionId,
    hostedSessions,
    quarantinedSessionIds: [...failureSnapshot.quarantinedDocuments.keys()],
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

  const shell = (
    <WorkspaceShell
      actions={actions}
      inspector={<CanvasInspectorRightSidebar />}
      inspectorAvailable={inspectorAvailable}
      mainContent={isSettingsOpen ? <SettingsContentRegion /> : mainContent}
      mainContentLabel={isSettingsOpen ? '设置' : undefined}
      model={workbench}
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
      renderChrome={({
        isSidebarOpen,
        tabs: chromeTabs,
        onSidebarToggle,
        onActivateTab,
        onCloseTab,
        onMoveTab,
        onCreateCanvas,
      }) => (
        <DesktopTitleBar
          activeTabSequence={describeTabSequence(isSettingsOpen ? [] : chromeTabs, onActivateTab)}
          isMaximized={isWindowMaximized}
          isSidebarOpen={isSidebarOpen}
          onClose={onWindowClose}
          onMaximize={onWindowMaximize}
          onMinimize={onWindowMinimize}
          onSidebarToggle={onSidebarToggle}
          windowControlsDisabled={!capabilities.windowControls}
        >
          {/* 设置界面没有标签：标签属于工作台，不属于设置。 */}
          {isSettingsOpen ? null : (
            <WorkbenchTabs
              onActivate={onActivateTab}
              onClose={onCloseTab}
              onCreate={onCreateCanvas}
              onMove={onMoveTab}
              tabs={chromeTabs}
            />
          )}
        </DesktopTitleBar>
      )}
      sidebarOverride={
        isSettingsOpen ? (
          <SettingsNavigationRegion
            footer={
              <SidebarFooter
                onDeveloperToolsOpen={onDeveloperToolsOpen}
                onSettingsOpen={onSettingsClose}
                settingsActive
              />
            }
          />
        ) : null
      }
      sidebarPanel={
        <AssistantSidebarPanel
          activeThreadId={activeConversationId}
          onCreate={openAssistantEntry}
          onOpen={startConversation}
          onOpenInNewTab={openConversationInNewTab}
        />
      }
      statusContent={<CanvasTransformStatus canvasTitle={activeCanvasTitle} />}
    />
  )

  if (!isSettingsOpen) {
    return shell
  }

  /*
   * 设置不是浮层：Provider 只提供状态，界面本身就是外壳栅格里的两个格子。
   * 工作区留在下面不卸载，返回要回到进入设置前的那个标签页。
   */
  return (
    <SettingsProvider
      agentConfigStore={agentConfigStore}
      onDismiss={onSettingsClose}
      store={settingsStore}
    >
      {shell}
    </SettingsProvider>
  )
}

/*
 * 两个箭头指向活动标签的前后邻居：索引只在这里算一次，切换仍旧走 store 的
 * activateTab（点击标签、命令面板用的是同一个入口）。
 *
 * 可用性不是另算的布尔，而是邻居存不存在——一次查找同时给出「能不能按」和
 * 「按了去哪」，两者不可能不一致。两端因此天然不回绕。
 *
 * 设置界面传进来的是空列表：那里不渲染标签条，箭头没有可指的对象，于是两个
 * 按钮由同一次派生得出禁用，不需要第二个开关。原注释以为「设置界面找不到
 * 活动标签」，但 chromeTabs 与设置状态无关，标签一直在，那个前提不成立。
 */
function describeTabSequence(
  tabs: readonly WorkbenchTabViewModel[],
  onActivateTab: (tabId: WorkbenchTabId) => void,
): ActiveTabSequence {
  const index = tabs.findIndex((tab) => tab.isActive)
  const previous = index > 0 ? tabs[index - 1] : undefined
  const next = index >= 0 && index < tabs.length - 1 ? tabs[index + 1] : undefined

  return {
    canActivatePrevious: previous !== undefined,
    canActivateNext: next !== undefined,
    activatePrevious() {
      if (previous) {
        onActivateTab(previous.id)
      }
    },
    activateNext() {
      if (next) {
        onActivateTab(next.id)
      }
    },
  }
}

interface ActiveSurfaceRendererProps {
  readonly activeSurface: import('@poietica/features-workspace/contracts').WorkbenchSurfaceViewModel
  readonly activeSessionId: CanvasSessionId | null
  readonly hostedSessions: readonly {
    readonly sessionId: CanvasSessionId
    readonly session: EditorSession
  }[]
  readonly quarantinedSessionIds: readonly string[]
  readonly onSave: (sessionId: CanvasSessionId) => void
  readonly onSessionFailure: (failure: EditorSessionFailure) => void
  readonly renderSessionFailure: (sessionId: string) => ReactNode
  readonly renderConversation: (threadId: string) => ReactNode
  readonly surfaceRenderers: WorkspaceSurfaceRenderers
}

function renderActiveSurface({
  activeSurface,
  activeSessionId,
  hostedSessions,
  quarantinedSessionIds,
  onSave,
  onSessionFailure,
  renderSessionFailure,
  renderConversation,
  surfaceRenderers,
}: ActiveSurfaceRendererProps) {
  switch (activeSurface.kind) {
    case 'workspace':
      return <WorkspaceSurface renderers={surfaceRenderers} surfaceId={activeSurface.surfaceId} />

    case 'conversation':
      return renderConversation(activeSurface.threadId)

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
