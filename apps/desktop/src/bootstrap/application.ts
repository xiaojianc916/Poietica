import type { AgentSessionPort } from '@poietica/agent-protocol'
import { createEditorSessionRegistry } from '@poietica/editor-core/application'
import { createCanvasDocumentService } from '@poietica/editor-document'
import {
  type CommandRegistry,
  createCommandRegistry,
  createWorkbenchSessionController,
} from '@poietica/features-workspace/application'
import type { WorkbenchSessionStore } from '@poietica/features-workspace/contracts'
import {
  type AgentConfigStore,
  createDesktopAgentConfigStore,
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
  readonly agentConfig: AgentConfigStore
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
  const agentConfig = createDesktopAgentConfigStore()

  /*
   * Read the agent profiles once at startup. That first read is what writes the
   * builtin profiles to agents.json when the file is still empty, and the native
   * side looks up both the program to spawn and its environment in that file.
   * The assistant reaches that path without ever opening the settings page, so
   * seeding only from there would leave it reading an empty file.
   */
  void agentConfig.load().catch(() => undefined)
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
    agentConfig,
    agentSession: agent.port,
    tldrawLicenseKey,

    async dispose() {
      termination.dispose()
      await canvases.dispose()
      await agent.dispose()
    },
  }
}
