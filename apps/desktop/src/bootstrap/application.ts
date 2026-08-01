import type { AgentSessionPort } from '@poietica/acp'
import {
  type AgentConfigStore,
  type AppUpdateController,
  createAppUpdateController,
  createDesktopAgentConfigStore,
  createDesktopSettingsStore,
  createMainWindowController,
  type MainWindowController,
  readAppVersion,
  type SettingsStore,
} from '@poietica/desktop-runtime'
import {
  type CommandRegistry,
  createCommandRegistry,
  createWorkbenchSessionController,
} from '@poietica/workspace/application'
import type { WorkbenchSessionStore } from '@poietica/workspace/contracts'
import { createDesktopAgentSession } from '../application/ai/agent-session'

export interface ApplicationRuntime {
  readonly workspace: WorkbenchSessionStore
  readonly commands: CommandRegistry
  readonly mainWindow: MainWindowController
  readonly appUpdate: AppUpdateController
  readonly settings: SettingsStore
  readonly agentConfig: AgentConfigStore
  readonly agentSession: AgentSessionPort
  /** 这个可执行文件自己的版本号。关于页面此前写死了它。 */
  readonly appVersion: () => Promise<string>
  readonly dispose: () => Promise<void>
}

export function createApplicationRuntime(): ApplicationRuntime {
  const workspace = createWorkbenchSessionController()
  const commands = createCommandRegistry()
  const mainWindow = createMainWindowController()
  const appUpdate = createAppUpdateController()
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

  /*
   * The agent session is constructed eagerly but connects lazily: no agent
   * process is spawned until the first prompt, so an application that never
   * opens the assistant pays nothing for it.
   */
  const agent = createDesktopAgentSession()

  return {
    workspace,
    commands,
    mainWindow,
    appUpdate,
    settings,
    agentConfig,
    agentSession: agent.port,
    appVersion: readAppVersion,

    async dispose() {
      await agent.dispose()
    },
  }
}
