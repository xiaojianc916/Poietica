import type { AppSettings } from '@poietica/agent-timeline'

export interface SettingsStore {
  readonly load: () => Promise<AppSettings>
  readonly save: (settings: AppSettings) => Promise<void>
  readonly reset: () => Promise<AppSettings>
}
