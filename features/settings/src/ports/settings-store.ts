import type { AppSettings } from '@poietica/platforms-desktop-ipc/generated/ipc-bindings'

export interface SettingsStore {
  readonly load: () => Promise<AppSettings>
  readonly save: (settings: AppSettings) => Promise<void>
  readonly reset: () => Promise<AppSettings>
}
