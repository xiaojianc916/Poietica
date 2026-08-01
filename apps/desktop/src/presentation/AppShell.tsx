import type { AgentSessionPort } from '@poietica/acp'
import { defaultAcpAgent } from '@poietica/agent-registry'
import { refreshAgentCapabilities } from '@poietica/agent-session'
import type { AgentDialect } from '@poietica/agent-ui'
import { AgentDialectProvider } from '@poietica/agent-ui'
import type { AppUpdateController, MainWindowController } from '@poietica/desktop-runtime'
import type { AgentConfigStore, SettingsStore } from '@poietica/settings'
import { applyThemePreference } from '@poietica/ui'
import type { CommandRegistry } from '@poietica/workspace/application'
import type { WorkbenchSessionStore } from '@poietica/workspace/contracts'
import { CommandPalette, useCommandKeybindings } from '@poietica/workspace/react'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ThreadsProvider } from '../application/ai/ThreadsProvider'
import { failureCoordinator } from '../application/failures/failure-coordinator'
import { reportFailure } from '../application/failures/failure-policy'
import { type ApplicationCommandContext, registerApplicationCommands } from './application-commands'
import { useWindowChrome } from './chrome/use-window-chrome'
import { UiFeedbackRegion } from './ui/ui-feedback'
import { UpdateCapsule } from './ui/update-capsule'
import { type AppCapabilities, WorkspaceContainer } from './workspace/WorkspaceContainer'

/**
 * 对面那家 agent 的方言。
 *
 * 会话本来就是拿这份档案建起来的(见 application/ai/agent-session.ts),
 * 所以「跟谁说话」和「它怎么说话」出自同一个答案,不会各说各的。
 * 界面包不认识名单,名单只在这一行露面。
 */
function dialectOf(agent: ReturnType<typeof defaultAcpAgent>): AgentDialect {
  return {
    optionLabels: agent.optionLabels,
    questions: agent.questionDialect === undefined ? [] : [agent.questionDialect],
  }
}

/* 一个进程一份:每次渲染新建一个对象会让整棵子树的记忆化失效。 */
const DIALECT = dialectOf(defaultAcpAgent())

export interface AppShellRuntime {
  readonly workspace: WorkbenchSessionStore
  readonly commands: CommandRegistry
  readonly mainWindow: MainWindowController
  readonly appUpdate: AppUpdateController
  readonly settings: SettingsStore
  readonly agentConfig: AgentConfigStore
  readonly agentSession: AgentSessionPort
  readonly appVersion: () => Promise<string>
}

export interface AppShellProps {
  readonly runtime: AppShellRuntime
}

export function AppShell({ runtime }: AppShellProps) {
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const [isSettingsOpen, setSettingsOpen] = useState(false)

  const {
    isMaximized: isWindowMaximized,
    minimize: minimizeWindow,
    toggleMaximize: maximizeWindow,
  } = useWindowChrome(runtime.mainWindow)

  const failureSnapshot = useSyncExternalStore(
    failureCoordinator.subscribe,
    failureCoordinator.getSnapshot,
    failureCoordinator.getSnapshot,
  )

  /*
   * 降级判断只在这里派生一次，并且是稳定引用：它此前既在本文件的五个回调里
   * 各写一遍，又以每次渲染新建的字符串数组传给工作区容器再算一遍，下游任何
   * 记忆化都被这个数组打掉。
   */
  const capabilities = useMemo<AppCapabilities>(() => {
    const degraded = failureSnapshot.degradedFeatures

    return {
      settings: !degraded.has('settings'),
      developerTools: !degraded.has('developer-tools'),
      windowControls: !degraded.has('window-controls'),
    }
  }, [failureSnapshot.degradedFeatures])

  const toggleCommandPalette = useCallback(() => {
    setCommandPaletteOpen((open) => !open)
  }, [])

  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), [])

  const openAssistantSurface = useCallback(() => {
    runtime.workspace.openWorkspaceSurface({ surfaceId: 'ai', title: 'AI' })
  }, [runtime.workspace])

  const openSettings = useCallback(() => {
    if (capabilities.settings) {
      setSettingsOpen(true)
    }
  }, [capabilities.settings])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
  }, [])

  /*
   * 关闭窗口就是关闭窗口。
   *
   * 此前这里要经过一个三态终止协调器，它唯一的存在理由是「退出前确认未保存的
   * 工作」——文档域移除之后没有任何东西需要被确认，于是那台状态机连同它的
   * 确认弹窗一起消失，不留一个恒返回 close-now 的空壳。
   */
  const closeWindow = useCallback(() => {
    void runtime.mainWindow.forceClose()
  }, [runtime.mainWindow])

  const openDeveloperTools = useCallback(() => {
    if (!capabilities.developerTools) {
      return
    }

    void runtime.mainWindow.openDeveloperTools().catch((cause: unknown) => {
      reportFailure('DEVELOPER_TOOLS_UNAVAILABLE', {
        scope: 'app-shell',
        operation: 'open-developer-tools',
        cause,
      })
    })
  }, [capabilities.developerTools, runtime.mainWindow])

  const commandContext = useMemo<ApplicationCommandContext>(
    () => ({
      workspace: runtime.workspace,
      toggleCommandPalette,
      openAssistantSurface,
    }),
    [openAssistantSurface, runtime.workspace, toggleCommandPalette],
  )

  /* 依赖是具体引用，不是整个 runtime：否则任一无关字段变化都会全量重注册。 */
  useEffect(
    () => registerApplicationCommands(runtime.commands, commandContext),
    [commandContext, runtime.commands],
  )

  useEffect(() => {
    let active = true

    void runtime.settings.load().then(
      (settings) => {
        if (!active) {
          return
        }

        applyThemePreference(settings.theme)
      },
      (cause: unknown) => {
        if (!active) {
          return
        }

        reportFailure('SETTINGS_LOAD_FAILED', {
          scope: 'app-shell',
          operation: 'load-settings',
          cause,
        })
      },
    )

    return () => {
      active = false
    }
  }, [runtime.settings])

  /*
   * 设置页动过 agent 的配置，工具条上那张能力表就不再作数。
   *
   * 订阅落在这里而不是 ConversationSurface：设置页展开时那一格可能已经卸载，
   * 通知会落空；而它重新挂载时 installAgentCapabilityPort 又会在 source === port
   * 上提前返回 —— 等于什么都没发生，人只好去重启。
   *
   * 这一层与方言、会话列表同级，都是「一个进程一份、活到进程结束」的事实。
   */
  useEffect(
    () => runtime.agentConfig.subscribeConfigChanged(refreshAgentCapabilities),
    [runtime.agentConfig],
  )

  useCommandKeybindings(runtime.commands)

  useTerminationRequests(runtime.mainWindow, closeWindow)

  return (
    /*
     * 会话状态在这里落地，一个进程一份。
     *
     * 它比工作区更宽：侧栏的列表、标签条上的那一格、输入框旁的选择器读的是
     * 同一份，否则列表亮着一条而标签停在另一条。
     */
    <AgentDialectProvider dialect={DIALECT}>
      <ThreadsProvider>
        <WorkspaceContainer
          agentConfigStore={runtime.agentConfig}
          agentSession={runtime.agentSession}
          appVersion={runtime.appVersion}
          capabilities={capabilities}
          isSettingsOpen={isSettingsOpen && capabilities.settings}
          isWindowMaximized={isWindowMaximized}
          onCommandPaletteOpen={openCommandPalette}
          onDeveloperToolsOpen={openDeveloperTools}
          onSettingsClose={closeSettings}
          onSettingsOpen={openSettings}
          onWindowClose={closeWindow}
          onWindowMaximize={maximizeWindow}
          onWindowMinimize={minimizeWindow}
          settingsStore={runtime.settings}
          sidebarFooterSlot={
            <UpdateCapsule controller={runtime.appUpdate} settings={runtime.settings} />
          }
          workspace={runtime.workspace}
        />

        <CommandPalette
          onOpenChange={setCommandPaletteOpen}
          open={isCommandPaletteOpen}
          registry={runtime.commands}
        />

        <UiFeedbackRegion />
      </ThreadsProvider>
    </AgentDialectProvider>
  )
}

/*
 * 关闭按钮与托盘"退出程序"是同一件事的两个入口，因此汇入同一个回调。
 * 托盘此前直接 app.exit(0)，绕开了窗口自己的关闭路径。
 */
function useTerminationRequests(
  mainWindow: MainWindowController,
  onCloseRequested: () => void,
): void {
  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    let unsubscribeTrayQuit: (() => void) | undefined

    const track =
      (assign: (dispose: () => void) => void, operation: string) => (dispose: () => void) => {
        if (disposed) {
          dispose()
          return
        }

        assign(dispose)
        void operation
      }

    void mainWindow.onTerminationRequested(onCloseRequested).then(
      track((dispose) => {
        unsubscribeTrayQuit = dispose
      }, 'register-tray-quit-listener'),
      (cause: unknown) => {
        if (!disposed) {
          reportFailure('WINDOW_CLOSE_LISTENER_UNAVAILABLE', {
            scope: 'app-shell',
            operation: 'register-tray-quit-listener',
            cause,
          })
        }
      },
    )

    void mainWindow.onCloseRequested(onCloseRequested).then(
      track((dispose) => {
        unsubscribe = dispose
      }, 'register-close-listener'),
      (cause: unknown) => {
        if (!disposed) {
          reportFailure('WINDOW_CLOSE_LISTENER_UNAVAILABLE', {
            scope: 'app-shell',
            operation: 'register-close-listener',
            cause,
          })
        }
      },
    )

    return () => {
      disposed = true
      unsubscribe?.()
      unsubscribeTrayQuit?.()
    }
  }, [mainWindow, onCloseRequested])
}
