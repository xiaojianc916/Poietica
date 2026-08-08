import { assertUnreachable } from '@poietica/core'

/*
 * 一项能力是谁带来的。
 *
 * 插件不是技能，也不是 MCP 服务器 —— 它是把它们打包分发的那个单元。Kimi 官方文档
 * 把这三样分在三处说：MCP 服务器写在 mcp.json 里，技能放在 skills/ 下，而插件
 * 「也可以」在清单里声明 MCP 服务器。插件是来源之一，不是这两样的定义。
 *
 * 所以这一位是联合而不是一个插件号。写成 pluginId: string 就等于在类型上断言「每一条
 * 能力必然属于某个插件」，而这句话是假的：本应用自带的那一台和 agent 自己配好的那些
 * 都无处安放。删掉其中任何一支，编译器会在全部引用点报错 —— 那正是它该有的行为。
 */

/**
 * 本应用自己在进程里起的那一台。
 *
 * 它不来自任何文件，也不属于任何插件：进程起来它就在，进程停了它就没了。因此这一支
 * 不需要第二个标识位 —— 全仓只有 contribution 一处产出它，名字归 plugin-store 定。
 */
export interface BuiltinOrigin {
  readonly kind: 'builtin'
}

export interface PluginOrigin {
  readonly kind: 'plugin'
  readonly pluginId: string
}

/**
 * 装在这个 agent 自己家里的：不经插件，由人或它自己的 CLI 写进去。
 *
 * 「自己家」的判据只有一条 —— 这个 agent 起进程时会去读的那个目录。受控 home 生效
 * 时它在数据根之下，不受控时在用户 home 里，两者都由原生侧算。别家客户端的配置文件
 * 不属于这一档：它们是真实存在的位置，但这个 agent 不读，列出来就是一排拨了不生效
 * 的开关。
 */
export interface UserOrigin {
  readonly kind: 'user'
  /** 落在哪个文件里。界面要显示它，排障也只能靠它。 */
  readonly location: string
}

export type ContributionOrigin = BuiltinOrigin | PluginOrigin | UserOrigin

/**
 * 本应用拨得动的那些。
 *
 * 机器上那份 mcp.json 不归本应用所有：从这个界面改它，等于替人改掉他下次在终端里跑
 * CLI 时的那套服务器。所以 UserOrigin 不在这个联合里 —— 「那几台改不了」是一条类型
 * 约束，由编译器执行，不靠每个调用点自觉。
 */
export type ManagedOrigin = BuiltinOrigin | PluginOrigin

/** 列表右边那个标签。 */
export function describeOrigin(origin: ContributionOrigin): string {
  switch (origin.kind) {
    case 'builtin':
      return '内置'
    case 'plugin':
      return origin.pluginId
    case 'user':
      return '个人'
    default:
      return assertUnreachable(origin)
  }
}
