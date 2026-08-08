import * as v from 'valibot'

import type { ContributionOrigin } from './origin'

/*
 * mcp.json 这份文档，拆成一台台服务器。
 *
 * 形状由 Kimi 官方文档给定：{ "mcpServers": { "<名字>": { …一台的配置… } } }，
 * 用户级与项目级同一份形状，插件清单里那一格也是同一份形状。所以文档拆解只有这一处，
 * 而一台服务器自己的配置继续交给 mcp-server 那个唯一的解码器 —— 这一层不碰传输。
 *
 * 收的是已经 parse 过的 JSON 而不是字符串：谁读的文件谁负责报告读不出来。读文件这件
 * 事不属于这一层，把它塞进来只会让这个纯函数变得要么能抛异常、要么要吞掉异常。
 */

export interface DeclaredMcpServer {
  readonly name: string
  readonly origin: ContributionOrigin
  readonly config: Readonly<Record<string, unknown>>
  /**
   * 配置文件里那个 enabled 字段。官方文档：Set to false to disable this server，
   * 缺省为真。它和人在界面上拨的那个开关不是一回事 —— 后者是本应用自己的偏好。
   */
  readonly enabledInConfig: boolean
}

export interface McpConfigDecoding {
  readonly servers: readonly DeclaredMcpServer[]
  /** 文档在，但不是这个形状。空文档与坏文档不能混为一谈。 */
  readonly malformed: boolean
}

const ServerEntry = v.looseObject({ enabled: v.optional(v.boolean()) })

const McpConfigDocument = v.looseObject({
  mcpServers: v.optional(v.record(v.string(), ServerEntry)),
})

export function decodeMcpConfig(origin: ContributionOrigin, document: unknown): McpConfigDecoding {
  const parsed = v.safeParse(McpConfigDocument, document)

  if (!parsed.success) {
    return { servers: [], malformed: true }
  }

  const servers = Object.entries(parsed.output.mcpServers ?? {}).map(([name, entry]) => ({
    name,
    origin,
    config: entry,
    enabledInConfig: entry.enabled !== false,
  }))

  return { servers, malformed: false }
}
