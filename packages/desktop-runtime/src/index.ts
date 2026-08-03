export type { AgentConfigStore, SettingsStore } from '@poietica/settings'
export { createDesktopAgentConfigStore } from './adapters/agent/agent-config-store'
export { readAppVersion } from './adapters/app-release'
export {
  type AppUpdateController,
  createAppUpdateController,
  type UpdateProgress,
  type UpdateRelease,
} from './adapters/app-update'
export { createAttachmentIntake } from './adapters/attachments'
export {
  type NativeCrashReport,
  takePreviousNativeCrashReport,
} from './adapters/native-crash-report'
export {
  createMainWindowController,
  type MainWindowController,
} from './adapters/native-window'
export { createDesktopSettingsStore } from './adapters/settings/settings-store'
