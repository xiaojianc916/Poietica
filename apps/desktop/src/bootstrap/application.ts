import type { AgentSessionPort } from '@poietica/agent-contract'
import {
  type AgentConfigStore,
  type AppUpdateController,
  createAppUpdateController,
  createDesktopAgentConfigStore,
  createDesktopSettingsStore,
  createMainWindowController,
  type MainWindowController,
  readAppVersion,
  readDataDirectory,
  type SettingsStore,
} from '@poietica/desktop-adapters'
import type { WorkbenchSessionStore } from '@poietica/workspace'
import {
  type CommandRegistry,
  createCommandRegistry,
  createWorkbenchSessionController,
} from '@poietica/workspace'
import { adoptAgent, createDesktopAgentSession } from '../assistant/agent-session'

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
  /** 这台机器上，这个应用的数据落在哪。关于页面要如实说出它。 */
  readonly dataDirectory: () => Promise<string>
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
  /*
   * 读回来的 defaultAgentId 就是「用哪一家」的答案。此前这一行把它丢掉了，于是
   * 对话那一路各自去读注册表的第一行 —— 用户在设置里选的那一家从来没有到达过
   * 会话。设置页改完会喊一声，所以这个答案不会停在启动那一刻。
   */
  const adoptChosenAgent = () => {
    void agentConfig
      .load()
      .then((snapshot) => {
        adoptAgent(snapshot.defaultAgentId)
      })
      .catch(() => undefined)
  }

  adoptChosenAgent()

  const releaseAgentChoice = agentConfig.subscribeConfigChanged(adoptChosenAgent)

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
    dataDirectory: readDataDirectory,

    async dispose() {
      releaseAgentChoice()
      await agent.dispose()
    },
  }
}
