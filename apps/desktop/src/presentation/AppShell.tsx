import { EditorProvider } from '@poietica/editor-core/react'
import { applyThemePreference, ConfirmationDialog } from '@poietica/foundations-design-system'
import type { MainWindowController } from '@poietica/platforms-desktop-runtime'
import type { SettingsStore } from '@poietica/features-settings'
import { SettingsDialog } from '@poietica/features-settings/react'
import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import type { CommandRegistry } from '@poietica/features-workspace/application'
import type { WorkbenchSessionStore } from '@poietica/features-workspace/contracts'
import { CommandPalette } from '@poietica/features-workspace/react'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { failureCoordinator } from '../application/failures/failure-coordinator'
import { reportFailure } from '../application/failures/failure-policy'
import type { ApplicationTerminationCoordinator } from '../application/termination/application-termination-coordinator'
import { useGlobalCommandShortcuts } from './commands/useGlobalCommandShortcuts'
import { UiFeedbackRegion } from './ui/ui-feedback'
import { type WorkspaceCanvasUIPort, WorkspaceContainer } from './workspace/WorkspaceContainer'

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

const GLOBAL_COMMAND_SHORTCUTS = [
  {
    key: 'k',
    commandId: 'application.toggle-command-palette',
    ctrlOrMeta: true,
  },
  {
    key: 'n',
    commandId: 'workspace.create-canvas',
    ctrlOrMeta: true,
  },
  {
    key: 'o',
    commandId: 'workspace.open-canvas',
    ctrlOrMeta: true,
  },
  {
    key: 'j',
    commandId: 'ai.open-assistant',
    ctrlOrMeta: true,
  },
] as const

export function AppShell({ runtime }: AppShellProps) {
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const [isSettingsOpen, setSettingsOpen] = useState(false)

  const isWindowMaximized = useWindowMaximizedState(runtime.mainWindow)

  const failureSnapshot = useSyncExternalStore(
    failureCoordinator.subscribe,
    failureCoordinator.getSnapshot,
    failureCoordinator.getSnapshot,
  )

  const settingsUnavailable = failureSnapshot.degradedFeatures.has('settings')

  const developerToolsUnavailable = failureSnapshot.degradedFeatures.has('developer-tools')

  const windowControlsUnavailable = failureSnapshot.degradedFeatures.has('window-controls')

  const windowDraggingUnavailable = failureSnapshot.degradedFeatures.has('window-dragging')

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
    if (settingsUnavailable) {
      return
    }

    setSettingsOpen(true)
  }, [settingsUnavailable])

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
    if (windowControlsUnavailable) {
      return
    }

    void runtime.mainWindow.minimize().catch((cause: unknown) => {
      reportFailure('WINDOW_MINIMIZE_UNAVAILABLE', {
        scope: 'app-shell',
        operation: 'minimize-window',
        cause,
      })
    })
  }, [windowControlsUnavailable, runtime.mainWindow])

  const maximizeWindow = useCallback(() => {
    if (windowControlsUnavailable) {
      return
    }

    void runtime.mainWindow.toggleMaximize().catch((cause: unknown) => {
      reportFailure('WINDOW_MAXIMIZE_UNAVAILABLE', {
        scope: 'app-shell',
        operation: 'toggle-maximize-window',
        cause,
      })
    })
  }, [windowControlsUnavailable, runtime.mainWindow])

  const openDeveloperTools = useCallback(() => {
    if (developerToolsUnavailable) {
      return
    }

    void runtime.mainWindow.openDeveloperTools().catch((cause: unknown) => {
      reportFailure('DEVELOPER_TOOLS_UNAVAILABLE', {
        scope: 'app-shell',
        operation: 'open-developer-tools',
        cause,
      })
    })
  }, [developerToolsUnavailable, runtime.mainWindow])

  const startWindowDragging = useCallback(() => {
    if (windowDraggingUnavailable) {
      return
    }

    void runtime.mainWindow.startDragging().catch((cause: unknown) => {
      reportFailure('WINDOW_DRAG_UNAVAILABLE', {
        scope: 'app-shell',
        operation: 'start-window-dragging',
        cause,
      })
    })
  }, [windowDraggingUnavailable, runtime.mainWindow])

  useApplicationCommands(
    runtime,
    toggleCommandPalette,
    openAssistantSurface,
    createCanvasWithFeedback,
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

  useGlobalCommandShortcuts(runtime.commands, GLOBAL_COMMAND_SHORTCUTS)

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
        degradedFeatures={[...failureSnapshot.degradedFeatures.keys()]}
        isWindowMaximized={isWindowMaximized}
        onCommandPaletteOpen={openCommandPalette}
        onDeveloperToolsOpen={openDeveloperTools}
        onSettingsOpen={openSettings}
        onWindowClose={requestApplicationClose}
        onWindowMaximize={maximizeWindow}
        onWindowMinimize={minimizeWindow}
        onWindowStartDragging={startWindowDragging}
        port={workspacePort}
      />

      <CommandPalette
        onOpenChange={setCommandPaletteOpen}
        open={isCommandPaletteOpen}
        registry={runtime.commands}
      />

      <SettingsDialog
        onOpenChange={setSettingsOpen}
        open={isSettingsOpen && !settingsUnavailable}
        store={runtime.settings}
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

function useApplicationCommands(
  runtime: AppShellRuntime,
  toggleCommandPalette: () => void,
  openAssistantSurface: () => void,
  createCanvas: (title: string) => Promise<void>,
): void {
  useEffect(() => {
    const unregister = [
      runtime.commands.register({
        id: 'application.toggle-command-palette',
        label: '切换命令面板',
        category: '应用',
        shortcut: 'Ctrl+K',
        execute: toggleCommandPalette,
      }),

      runtime.commands.register({
        id: 'workspace.create-canvas',
        label: '新建画布',
        category: '文件',
        shortcut: 'Ctrl+N',
        execute() {
          void createCanvas('未命名画布')
        },
      }),

      runtime.commands.register({
        id: 'workspace.open-canvas',
        label: '打开画布',
        category: '文件',
        shortcut: 'Ctrl+O',
        execute: runtime.canvases.open,
      }),

      runtime.commands.register({
        id: 'ai.open-assistant',
        label: '打开 AI 助手',
        category: '应用',
        shortcut: 'Ctrl+J',
        execute: openAssistantSurface,
      }),
    ]

    return () => {
      for (let index = unregister.length - 1; index >= 0; index -= 1) {
        unregister[index]?.()
      }
    }
  }, [createCanvas, openAssistantSurface, runtime, toggleCommandPalette])
}
