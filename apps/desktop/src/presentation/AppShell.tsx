import { EditorProvider } from '@poietica/editor-core/react'
import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import type { SettingsStore } from '@poietica/features-settings'
import type { CommandRegistry } from '@poietica/features-workspace/application'
import type { WorkbenchSessionStore } from '@poietica/features-workspace/contracts'
import { CommandPalette, useCommandKeybindings } from '@poietica/features-workspace/react'
import { applyThemePreference, ConfirmationDialog } from '@poietica/foundations-design-system'
import type { MainWindowController } from '@poietica/platforms-desktop-runtime'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { failureCoordinator } from '../application/failures/failure-coordinator'
import { reportFailure } from '../application/failures/failure-policy'
import type { ApplicationTerminationCoordinator } from '../application/termination/application-termination-coordinator'
import { type ApplicationCommandContext, registerApplicationCommands } from './application-commands'
import { UiFeedbackRegion } from './ui/ui-feedback'
import {
  type AppCapabilities,
  type WorkspaceCanvasUIPort,
  WorkspaceContainer,
} from './workspace/WorkspaceContainer'

export interface AppShellRuntime {
  readonly workspace: WorkbenchSessionStore
  readonly commands: CommandRegistry
  readonly canvases: WorkspaceCanvasUIPort
  readonly termination: ApplicationTerminationCoordinator
  readonly mainWindow: MainWindowController
  readonly settings: SettingsStore
  readonly agentSession: AgentSessionPort
  readonly tldrawLicenseKey: string
}

export interface AppShellProps {
  readonly runtime: AppShellRuntime
}

export function AppShell({ runtime }: AppShellProps) {
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const [isSettingsOpen, setSettingsOpen] = useState(false)

  const isWindowMaximized = useWindowMaximizedState(runtime.mainWindow)

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

  const termination = useSyncExternalStore(
    runtime.termination.subscribe,
    runtime.termination.getSnapshot,
    runtime.termination.getSnapshot,
  )

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

  const createCanvasWithFeedback = useCallback(
    async (title: string): Promise<void> => {
      try {
        await runtime.canvases.create(title)
      } catch (cause) {
        reportFailure('CANVAS_CREATE_FAILED', {
          scope: 'app-shell',
          operation: 'create-canvas',
          cause,
        })
      }
    },
    [runtime.canvases],
  )

  const requestApplicationClose = useCallback(() => {
    runtime.termination.request('window-close')
  }, [runtime.termination])

  const minimizeWindow = useCallback(() => {
    void runtime.mainWindow.minimize().catch((cause: unknown) => {
      reportFailure('WINDOW_MINIMIZE_UNAVAILABLE', {
        scope: 'app-shell',
        operation: 'minimize-window',
        cause,
      })
    })
  }, [runtime.mainWindow])

  const maximizeWindow = useCallback(() => {
    void runtime.mainWindow.toggleMaximize().catch((cause: unknown) => {
      reportFailure('WINDOW_MAXIMIZE_UNAVAILABLE', {
        scope: 'app-shell',
        operation: 'toggle-maximize-window',
        cause,
      })
    })
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
      canvases: runtime.canvases,
      createCanvas: createCanvasWithFeedback,
      toggleCommandPalette,
      openAssistantSurface,
    }),
    [
      createCanvasWithFeedback,
      openAssistantSurface,
      runtime.canvases,
      runtime.workspace,
      toggleCommandPalette,
    ],
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

  useCommandKeybindings(runtime.commands)

  useMainWindowCloseRequest(runtime.mainWindow, requestApplicationClose)

  const workspacePort = useMemo(
    () => ({
      canvases: {
        ...runtime.canvases,
        create: createCanvasWithFeedback,
      },
      workspace: runtime.workspace,
    }),
    [createCanvasWithFeedback, runtime.canvases, runtime.workspace],
  )

  return (
    <EditorProvider licenseKey={runtime.tldrawLicenseKey}>
      <WorkspaceContainer
        agentSession={runtime.agentSession}
        capabilities={capabilities}
        isSettingsOpen={isSettingsOpen && capabilities.settings}
        isWindowMaximized={isWindowMaximized}
        onCommandPaletteOpen={openCommandPalette}
        onDeveloperToolsOpen={openDeveloperTools}
        onSettingsClose={closeSettings}
        onSettingsOpen={openSettings}
        onWindowClose={requestApplicationClose}
        onWindowMaximize={maximizeWindow}
        onWindowMinimize={minimizeWindow}
        port={workspacePort}
        settingsStore={runtime.settings}
      />

      <CommandPalette
        onOpenChange={setCommandPaletteOpen}
        open={isCommandPaletteOpen}
        registry={runtime.commands}
      />

      <UiFeedbackRegion />

      <ConfirmationDialog
        confirmLabel="放弃全部并退出"
        description={
          termination.state === 'confirmation-required'
            ? `有 ${termination.sessionIds.length} 个画布包含未保存的更改。`
            : ''
        }
        destructive
        onCancel={runtime.termination.cancel}
        onConfirm={runtime.termination.confirmDiscard}
        open={termination.state === 'confirmation-required'}
        title="退出并放弃未保存的更改？"
      />
    </EditorProvider>
  )
}

function useWindowMaximizedState(mainWindow: MainWindowController): boolean {
  const [isMaximized, setMaximized] = useState(false)

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    let requestVersion = 0

    function synchronizeMaximizedState() {
      const currentVersion = ++requestVersion

      void mainWindow.isMaximized().then(
        (nextIsMaximized) => {
          if (!active || currentVersion !== requestVersion) {
            return
          }

          setMaximized(nextIsMaximized)
        },
        (cause: unknown) => {
          if (!active) {
            return
          }

          reportFailure('WINDOW_STATE_QUERY_UNAVAILABLE', {
            scope: 'app-shell',
            operation: 'query-window-maximized',
            cause,
          })
        },
      )
    }

    synchronizeMaximizedState()

    void mainWindow.onResized(synchronizeMaximizedState).then(
      (nextUnsubscribe) => {
        if (!active) {
          nextUnsubscribe()
          return
        }

        unsubscribe = nextUnsubscribe
      },
      (cause: unknown) => {
        if (!active) {
          return
        }

        reportFailure('WINDOW_RESIZE_SYNC_UNAVAILABLE', {
          scope: 'app-shell',
          operation: 'register-window-resize-listener',
          cause,
        })
      },
    )

    return () => {
      active = false
      requestVersion += 1
      unsubscribe?.()
    }
  }, [mainWindow])

  return isMaximized
}

function useMainWindowCloseRequest(
  mainWindow: MainWindowController,
  onCloseRequested: () => void,
): void {
  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined

    void mainWindow.onCloseRequested(onCloseRequested).then(
      (nextUnsubscribe) => {
        if (disposed) {
          nextUnsubscribe()
          return
        }

        unsubscribe = nextUnsubscribe
      },
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
    }
  }, [mainWindow, onCloseRequested])
}
