export type ThemeMode = 'light' | 'dark' | 'system'

export interface PrivacySettings {
  readonly telemetry: boolean
  readonly crashReporting: boolean
  readonly updateCheck: boolean
}

/*
 * 应用设置的形状。
 *
 * 这里的每一个字段都有界面读写，也都落盘。此前还有 canvas / editor / export
 * 三组：画布随产品形态一起删掉，editor 那七个字段从来就没有任何界面消费者。
 * 它们的真相来源是 src-tauri 的 AppSettings，所以那一侧先删，这里跟着收缩，
 * 而不是在这一层留一个"界面看不见但仍在写回"的状态面。
 */
export interface AppSettings {
  readonly theme: ThemeMode
  readonly language: string
  readonly shortcuts: Readonly<Record<string, string>>
  readonly privacy: PrivacySettings
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'zh-CN',
  shortcuts: {},
  privacy: {
    telemetry: false,
    crashReporting: true,
    updateCheck: true,
  },
}
