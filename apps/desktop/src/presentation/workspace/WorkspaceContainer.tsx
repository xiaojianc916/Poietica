import type { AgentSessionPort } from '@poietica/agent-protocol'
import type { AgentConfigStore, SettingsStore } from '@poietica/features-settings'
import {
  SettingsContentRegion,
  SettingsNavigationRegion,
  SettingsProvider,
} from '@poietica/features-settings/react'
import {
  CONVERSATION_ENTRY_TITLE,
  type WorkbenchSessionStore,
  type WorkbenchTabId,
  type WorkbenchTabViewModel,
  type WorkspaceShellActions,
} from '@poietica/features-workspace/contracts'
import {
  SidebarFooter,
  WorkbenchTabs,
  WorkspaceShell,
  WorkspaceSurface,
} from '@poietica/features-workspace/react'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { type ActiveTabSequence, DesktopTitleBar } from '../chrome/DesktopTitleBar'
import { AssistantSidebarPanel } from './AssistantSidebarPanel'
import { createAssistantWiring } from './assistant-wiring'

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

export interface WorkspaceContainerProps {
  readonly agentSession: AgentSessionPort
  readonly workspace: WorkbenchSessionStore
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
  workspace,
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
  const workbench = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
    workspace.getSnapshot,
  )

  const actions = useMemo<WorkspaceShellActions>(
    () => ({
      activateTab(tabId) {
        workspace.activateTab(tabId)
      },

      closeTab(tabId) {
        workspace.closeTab(tabId)
      },

      moveTab(tabId, targetIndex) {
        workspace.moveTab(tabId, targetIndex)
      },

      openWorkspaceSurface(surfaceId, title) {
        workspace.openWorkspaceSurface({ surfaceId, title })
      },

      openCommandPalette: onCommandPaletteOpen,

      openDeveloperTools: onDeveloperToolsOpen,

      openSettingsWindow: onSettingsOpen,
    }),
    [onCommandPaletteOpen, onDeveloperToolsOpen, onSettingsOpen, workspace],
  )

  /* 侧栏高亮的那一行就是正在看的那一格：身份来自工作台，没有第二份状态。 */
  const activeConversationId =
    workbench.activeSurface.kind === 'conversation' ? workbench.activeSurface.threadId : null

  /*
   * 一条对话开口说话的那一刻，AI 那一格就变成这条对话。
   *
   * openConversation 会就地顶掉 workspace:ai（会话槽本来的规则），于是标签
   * 标题变成这句话、activeSurface 变成 conversation，左侧高亮也随之落到列表
   * 的那一行——三件事同一个来源，不需要各自同步。
   */
  const startConversation = useCallback(
    (threadId: string, title: string) => {
      workspace.openConversation({ threadId, title })
    },
    [workspace],
  )

  /*
   * 侧栏那三根线也钉住标识：它们此前是 JSX 里的内联箭头，于是任何一次无关
   * 重渲都要把整张会话列表重画一遍。
   *
   * 打开一条对话与「说出第一句话」是同一件事，共用 startConversation。
   */
  const openAssistantEntry = useCallback(() => {
    workspace.openWorkspaceSurface({ surfaceId: 'ai', title: CONVERSATION_ENTRY_TITLE })
  }, [workspace])

  const openConversationInNewTab = useCallback(
    (threadId: string, title: string) => {
      workspace.openConversationInNewTab({ threadId, title })
    },
    [workspace],
  )

  const assistant = useMemo(
    () => createAssistantWiring(agentSession, startConversation),
    [agentSession, startConversation],
  )

  /*
   * 两种表面形态，穷尽，没有兜底分支：一条对话，或者一个工作区表面。
   */
  const mainContent =
    workbench.activeSurface.kind === 'conversation' ? (
      assistant.renderConversation(workbench.activeSurface.threadId)
    ) : (
      <WorkspaceSurface
        renderers={assistant.surfaces}
        surfaceId={workbench.activeSurface.surfaceId}
      />
    )

  const shell = (
    <WorkspaceShell
      actions={actions}
      mainContent={isSettingsOpen ? <SettingsContentRegion /> : mainContent}
      mainContentLabel={isSettingsOpen ? '设置' : undefined}
      model={workbench}
      renderChrome={({
        isSidebarOpen,
        tabs: chromeTabs,
        onSidebarToggle,
        onActivateTab,
        onCloseTab,
        onMoveTab,
        onCreateConversation,
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
              onCreate={onCreateConversation}
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
