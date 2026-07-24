import { EditorProvider } from '@hybrid-canvas/canvas/react'
import { applyThemePreference, ConfirmationDialog } from '@hybrid-canvas/design-system'
import { error as reportDiagnosticError } from '@hybrid-canvas/foundations-observability'
import type { MainWindowController } from '@hybrid-canvas/platforms-desktop-runtime'
import type { SettingsStore } from '@hybrid-canvas/settings'
import { SettingsDialog } from '@hybrid-canvas/settings/react'
import type { CommandRegistry } from '@hybrid-canvas/workspace/application'
import type { WorkbenchSessionStore } from '@hybrid-canvas/workspace/contracts'
import { CommandPalette } from '@hybrid-canvas/workspace/react'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { failureRuntime } from '../application/failures/failure-runtime'
import { createFeatureAvailability } from '../application/failures/feature-availability'
import type { ApplicationTerminationCoordinator } from '../application/termination/application-termination-coordinator'
import { useGlobalCommandShortcuts } from './commands/useGlobalCommandShortcuts'
import { reportUiFailure as reportFailure, UiFeedbackRegion } from './ui/ui-feedback'
import { type WorkspaceCanvasUIPort, WorkspaceContainer } from './workspace/WorkspaceContainer'

export interface AppShellRuntime {
  readonly workspace: WorkbenchSessionStore
  readonly commands: CommandRegistry
  readonly canvases: WorkspaceCanvasUIPort
  readonly termination: ApplicationTerminationCoordinator
  readonly mainWindow: MainWindowController
  readonly settings: SettingsStore
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
] as const

export function AppShell({ runtime }: AppShellProps) {
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const [isSettingsOpen, setSettingsOpen] = useState(false)

  const isWindowMaximized = useWindowMaximizedState(runtime.mainWindow)

  const [failedCanvasTitle, setFailedCanvasTitle] = useState<string | null>(null)

  const failureSnapshot = useSyncExternalStore(
    failureRuntime.subscribe,
    failureRuntime.getSnapshot,
    failureRuntime.getSnapshot,
  )

  const featureAvailability = useMemo(
    () => createFeatureAvailability(failureSnapshot.degradedFeatures),
    [failureSnapshot.degradedFeatures],
  )

  const termination = useSyncExternalStore(
    runtime.termination.subscribe,
    runtime.termination.getSnapshot,
    runtime.termination.getSnapshot,
  )

  const toggleCommandPalette = useCallback(() => {
    setCommandPaletteOpen((open) => !open)
  }, [])

  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), [])

  const openSettings = useCallback(() => {
    if (!featureAvailability.isAvailable('settings')) {
      return
    }

    setSettingsOpen(true)
  }, [featureAvailability])

  const createCanvasWithFeedback = useCallback(
    async (title: string): Promise<void> => {
      try {
        await runtime.canvases.create(title)
        setFailedCanvasTitle(null)
      } catch (cause) {
        reportDiagnosticError('canvas create failed', {
          scope: 'app-shell',
          operation: 'create-canvas',
          cause,
        })

        setFailedCanvasTitle(title)
      }
    },
    [runtime.canvases],
  )

  const requestApplicationClose = useCallback(() => {
    runtime.termination.request('window-close')
  }, [runtime.termination])

  const minimizeWindow = useCallback(() => {
    if (!featureAvailability.isAvailable('window-controls')) {
      return
    }

    void runtime.mainWindow.minimize().catch((cause: unknown) => {
      reportFailure('main window minimize failed', {
        scope: 'app-shell',
        operation: 'minimize-window',
        cause,
      })
    })
  }, [featureAvailability, runtime.mainWindow])

  const maximizeWindow = useCallback(() => {
    if (!featureAvailability.isAvailable('window-controls')) {
      return
    }

    void runtime.mainWindow.toggleMaximize().catch((cause: unknown) => {
      reportFailure('main window maximize failed', {
        scope: 'app-shell',
        operation: 'toggle-maximize-window',
        cause,
      })
    })
  }, [featureAvailability, runtime.mainWindow])

  const openDeveloperTools = useCallback(() => {
    if (!featureAvailability.isAvailable('developer-tools')) {
      return
    }

    void runtime.mainWindow.openDeveloperTools().catch((cause: unknown) => {
      reportFailure('open developer tools failed', {
        scope: 'app-shell',
        operation: 'open-developer-tools',
        cause,
      })
    })
  }, [featureAvailability, runtime.mainWindow])

  const startWindowDragging = useCallback(() => {
    if (!featureAvailability.isAvailable('window-dragging')) {
      return
    }

    void runtime.mainWindow.startDragging().catch((cause: unknown) => {
      reportFailure('main window drag failed', {
        scope: 'app-shell',
        operation: 'start-window-dragging',
        cause,
      })
    })
  }, [featureAvailability, runtime.mainWindow])

  useApplicationCommands(runtime, toggleCommandPalette, createCanvasWithFeedback)

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

        reportFailure('settings load failed', {
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
        degradedFeatures={failureSnapshot.degradedFeatures}
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
        open={isSettingsOpen && featureAvailability.isAvailable('settings')}
        store={runtime.settings}
      />

      <UiFeedbackRegion />

      <ConfirmationDialog
        cancelLabel="取消"
        confirmLabel="重试"
        description="无法新建画布，请重试。"
        onCancel={() => {
          setFailedCanvasTitle(null)
        }}
        onConfirm={() => {
          if (!failedCanvasTitle) {
            return
          }

          createCanvasWithFeedback(failedCanvasTitle)
        }}
        open={failedCanvasTitle !== null}
        title="新建画布失败"
      />

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

          reportFailure('window maximize state query failed', {
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

        reportFailure('window resize listener registration failed', {
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
          reportFailure('main window close listener registration failed', {
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
    ]

    return () => {
      for (let index = unregister.length - 1; index >= 0; index -= 1) {
        unregister[index]?.()
      }
    }
  }, [createCanvas, runtime, toggleCommandPalette])
}
