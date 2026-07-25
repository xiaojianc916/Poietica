import { createEditorSessionRegistry } from '@poietica/editor-core/application'
import { createCanvasDocumentService } from '@poietica/editor-document'
import {
  createDesktopSettingsStore,
  createDocumentFileCommands,
  createMainWindowController,
  createNativeTLAssetStoreSession,
  type MainWindowController,
  type SettingsStore,
} from '@poietica/platforms-desktop-runtime'
import {
  type CommandRegistry,
  createCommandRegistry,
  createWorkbenchSessionController,
} from '@poietica/features-workspace/application'
import type { WorkbenchSessionStore } from '@poietica/features-workspace/contracts'
import { type CanvasWorkflow, createCanvasWorkflow } from '../application/canvas/canvas-workflow'
import {
  type ApplicationTerminationCoordinator,
  createApplicationTerminationCoordinator,
} from '../application/termination/application-termination-coordinator'

export interface CreateApplicationRuntimeOptions {
  readonly tldrawLicenseKey: string
}

export interface ApplicationRuntime {
  readonly workspace: WorkbenchSessionStore
  readonly commands: CommandRegistry
  readonly canvases: CanvasWorkflow
  readonly termination: ApplicationTerminationCoordinator
  readonly mainWindow: MainWindowController
  readonly settings: SettingsStore
  readonly tldrawLicenseKey: string
  readonly dispose: () => Promise<void>
}

export function createApplicationRuntime({
  tldrawLicenseKey,
}: CreateApplicationRuntimeOptions): ApplicationRuntime {
  const workspace = createWorkbenchSessionController()
  const commands = createCommandRegistry()
  const documentsGateway = createDocumentFileCommands()
  const mainWindow = createMainWindowController()
  const settings = createDesktopSettingsStore()
  const editorSessions = createEditorSessionRegistry(createNativeTLAssetStoreSession)

  const documents = createCanvasDocumentService({
    editorSessions,
    persistence: documentsGateway,
    extensions: [],
  })

  const canvases = createCanvasWorkflow(documents, workspace)

  const termination = createApplicationTerminationCoordinator(canvases, {
    terminate: () => mainWindow.forceClose(),
  })

  return {
    workspace,
    commands,
    canvases,
    termination,
    mainWindow,
    settings,
    tldrawLicenseKey,

    async dispose() {
      termination.dispose()
      await canvases.dispose()
    },
  }
}
