import { createEditorSessionRegistry } from '@poietica/editor-core/application'
import { createCanvasDocumentService } from '@poietica/editor-document'
import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import {
  type CommandRegistry,
  createCommandRegistry,
  createWorkbenchSessionController,
} from '@poietica/features-workspace/application'
import type { WorkbenchSessionStore } from '@poietica/features-workspace/contracts'
import {
  createDesktopSettingsStore,
  createDocumentFileCommands,
  createMainWindowController,
  createNativeTLAssetStoreSession,
  type MainWindowController,
  type SettingsStore,
} from '@poietica/platforms-desktop-runtime'
import { createDesktopAgentSession } from '../application/ai/agent-session'
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
  readonly agentSession: AgentSessionPort
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

  /*
   * The agent session is constructed eagerly but connects lazily: no agent
   * process is spawned until the first prompt, so an application that never
   * opens the assistant pays nothing for it.
   */
  const agent = createDesktopAgentSession()

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
    agentSession: agent.port,
    tldrawLicenseKey,

    async dispose() {
      termination.dispose()
      await canvases.dispose()
      await agent.dispose()
    },
  }
}
