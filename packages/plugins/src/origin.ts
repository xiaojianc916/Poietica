import { assertUnreachable } from '@poietica/core'

/*
 * 一项能力是谁带来的。
 *
 * 插件不是技能，也不是 MCP 服务器 —— 它是把它们打包分发的那个单元。Kimi 官方文档
 * 把这三样分在三处说：MCP 服务器写在 mcp.json 里（用户级 ~/.kimi-code/mcp.json、
 * 项目级 .kimi-code/mcp.json），技能放在 $KIMI_CODE_HOME/skills/ 与
 * ~/.agents/skills/，而插件「也可以」在清单里声明 MCP 服务器。插件是来源之一，
 * 不是这两样的定义。
 *
 * 此前这一位是一个 readonly pluginId: string，等于在类型上断言「每一条能力必然属于
 * 某个插件」—— 那句话是假的，而假在类型里，本机已经配好的服务器就根本无法表达。
 */

export interface PluginOrigin {
  readonly kind: 'plugin'
  readonly pluginId: string
}

/** 用户自己在这台机器上配的。本应用只读它。 */
export interface UserOrigin {
  readonly kind: 'user'
  /** 落在哪个文件里。界面要显示它，排障也只能靠它。 */
  readonly location: string
}

export type ContributionOrigin = PluginOrigin | UserOrigin

/** 列表右边那个标签。 */
export function describeOrigin(origin: ContributionOrigin): string {
  switch (origin.kind) {
    case 'plugin':
      return origin.pluginId
    case 'user':
      return '个人'
    default:
      return assertUnreachable(origin)
  }
}
