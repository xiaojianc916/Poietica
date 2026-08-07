import { type AppSettings as AppSettingsDto, commands } from '@poietica/ipc/generated/ipc-bindings'
import type { AppSettings, SettingsStore } from '@poietica/settings'

/*
 * 设置在桌面端的存储。
 *
 * 边界上只剩一处真实的翻译：Rust 的 HashMap 生成出来是
 * Partial<Record<string, string>>，每个键都可能缺值，而领域里的快捷键表不接受
 * undefined。其余字段两侧同名同类型（生成物本来就是 camelCase，主题是同一个
 * 三值联合），所以既没有逐字段抄写的转换函数，也没有把已经收窄的联合再 switch
 * 一遍的主题解析——那两层挡不住任何错误，只会让每加一个设置项都要改两遍。
 */
export function createDesktopSettingsStore(): SettingsStore {
  return {
    async load() {
      return fromDto(await commands.settingsGet())
    },

    async save(settings) {
      await commands.settingsSet(settings)
    },

    async reset() {
      return fromDto(await commands.settingsReset())
    },
  }
}

function fromDto(dto: AppSettingsDto): AppSettings {
  return { ...dto, shortcuts: definedShortcuts(dto.shortcuts) }
}

function definedShortcuts(
  shortcuts: AppSettingsDto['shortcuts'],
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(shortcuts).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}
