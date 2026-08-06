import type { AppSettings } from './settings'

/*
 * 端口说领域的语言。
 *
 * 这里原本引用生成的 IPC 绑定，等于让功能层反向依赖桌面传输层的形状：适配器
 * 那侧再怎么翻译都是白翻，因为 save 的入参类型早被 DTO 钉死了——之前那 25 条
 * typecheck 错误就是这么来的，而且从第一天起就没编译通过过。端口只描述"设置
 * 怎么存取"；谁来存、线上是什么形状，是适配器的事。
 */
export interface SettingsStore {
  readonly load: () => Promise<AppSettings>
  readonly save: (settings: AppSettings) => Promise<void>
  readonly reset: () => Promise<AppSettings>
}
