import type { CommandRegistry, WorkbenchSessionStore } from '@poietica/workspace'
import { workspaceLayoutStore } from '@poietica/workspace'

/**
 * 应用命令的唯一声明表。
 *
 * id、文案、类别、快捷键与行为都是数据，不是散在 useEffect 里的六次调用：
 * 那种写法把产品文案硬编在生命周期里，effect 依赖也被迫写成整个 runtime 对象，
 * 于是 runtime 任一引用变化都会全量注销再重注册。
 *
 * 注册项类型直接从注册表签名派生，避免这里再养一份会漂移的接口副本。
 */
type CommandRegistration = Parameters<CommandRegistry['register']>[0]

export interface ApplicationCommandContext {
  readonly workspace: WorkbenchSessionStore
  readonly toggleCommandPalette: () => void
  readonly openAssistantSurface: () => void
}

type ApplicationCommand = Omit<CommandRegistration, 'execute'> & {
  readonly execute: (context: ApplicationCommandContext) => void
}

const APPLICATION_COMMANDS: readonly ApplicationCommand[] = [
  {
    id: 'application.toggle-command-palette',
    label: '切换命令面板',
    category: '应用',
    shortcut: 'Mod+K',
    execute: (context) => {
      context.toggleCommandPalette()
    },
  },
  {
    id: 'workspace.toggle-sidebar',
    label: '切换侧边栏',
    category: '视图',
    shortcut: 'Mod+B',
    execute: () => {
      workspaceLayoutStore.toggleSidebar()
    },
  },
  {
    id: 'ai.open-assistant',
    label: '打开 AI 助手',
    category: '应用',
    shortcut: 'Mod+J',
    execute: (context) => {
      context.openAssistantSurface()
    },
  },
]

/** 把声明表接上注册表，返回按注册逆序注销的清理函数。 */
export function registerApplicationCommands(
  registry: CommandRegistry,
  context: ApplicationCommandContext,
): () => void {
  const unregister = APPLICATION_COMMANDS.map(({ execute, ...declaration }) =>
    registry.register({
      ...declaration,
      execute: () => {
        execute(context)
      },
    }),
  )

  return () => {
    for (let index = unregister.length - 1; index >= 0; index -= 1) {
      unregister[index]?.()
    }
  }
}
