import type { AppSettings, SettingsStore, ThemeMode } from '@poietica/features-settings'
import {
  type AppSettings as AppSettingsDto,
  commands,
} from '@poietica/platforms-desktop-ipc/generated/ipc-bindings'

/*
 * 设置在桌面端的存储。
 *
 * 边界上只做两件真实的翻译：主题字符串收窄成 ThemeMode，快捷键表去掉没有值的
 * 键。其余字段两侧同名同类型——specta 生成的绑定本来就是 camelCase——所以不再
 * 有逐字段抄写的 fromDto/toDto：那层既不能防错（类型系统才能），又让每加一个
 * 设置项都要在两个方向上各改一遍，改漏了才由编译器来提醒。
 */
export function createDesktopSettingsStore(): SettingsStore {
  return {
    async load() {
      return fromDto(await commands.settingsGet())
    },

    async save(settings) {
      await commands.settingsSet(toDto(settings))
    },

    async reset() {
      return fromDto(await commands.settingsReset())
    },
  }
}

function fromDto(dto: AppSettingsDto): AppSettings {
  return { ...dto, theme: parseTheme(dto.theme), shortcuts: definedShortcuts(dto.shortcuts) }
}

function toDto(settings: AppSettings): AppSettingsDto {
  return { ...settings, shortcuts: { ...settings.shortcuts } }
}

/* 绑定里的快捷键表每个键都可能缺值；领域模型不接受 undefined。 */
function definedShortcuts(
  shortcuts: Partial<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(shortcuts).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

/* 落盘的主题是任意字符串（可能来自旧版本或手改的配置），认不出就回系统。 */
function parseTheme(value: string): ThemeMode {
  switch (value) {
    case 'light':
    case 'dark':
    case 'system':
      return value
    default:
      return 'system'
  }
}
