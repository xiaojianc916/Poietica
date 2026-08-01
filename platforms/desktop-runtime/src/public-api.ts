export type { AgentConfigStore, SettingsStore } from '@poietica/features-settings'
export { createDesktopAgentConfigStore } from './adapters/agent/agent-config-store'
export { readAppVersion } from './adapters/app-release'
export {
  type AppUpdateController,
  createAppUpdateController,
  type UpdateProgress,
  type UpdateRelease,
} from './adapters/app-update'
export {
  type NativeCrashReport,
  takePreviousNativeCrashReport,
} from './adapters/native-crash-report'
export {
  createMainWindowController,
  type MainWindowController,
} from './adapters/native-window'
export { createDesktopSettingsStore } from './adapters/settings/settings-store'
