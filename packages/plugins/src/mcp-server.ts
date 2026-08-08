import * as v from 'valibot'

/*
 * ACP 的 McpServer 线上形状，以及从 MCP 配置解出它的那一步。
 *
 * 判别式由协议钉死：schema 那一侧是
 * #[serde(tag = "type", rename_all = "snake_case")]，而 Stdio 那一支额外标了
 * #[serde(untagged)] —— 所以 http 与 sse 带 type，stdio 不带。三个结构体全是
 * #[non_exhaustive]，原生侧因此只能反序列化、不能构造，这也正是这里要产出
 * 线上形状而不是产出一个自造 DTO 的原因。
 *
 * 插件清单里那一格的写法归 MCP 规范所有（Kimi 官方文档：plugin 的 mcpServers
 * 复用 MCP 的 schema），判别字段是 transport。认不出的传输不猜，交回 undefined，
 * 由调用方记一条诊断 —— 静默丢弃会把「装上了却没反应」变成查不出原因的问题。
 */

export interface McpServerHttpWire {
  readonly type: 'http' | 'sse'
  readonly name: string
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
}

export interface McpServerStdioWire {
  readonly name: string
  readonly command: string
  readonly args: readonly string[]
  readonly env: readonly { readonly name: string; readonly value: string }[]
}

export type McpServerWire = McpServerHttpWire | McpServerStdioWire

/** 哪些传输这一次真的送得出去。由 agent 握手时自己说。 */
export interface McpTransports {
  readonly http: boolean
  readonly sse: boolean
}

const HttpConfig = v.looseObject({
  transport: v.picklist(['http', 'sse']),
  url: v.string(),
  headers: v.optional(v.record(v.string(), v.string())),
})

const StdioConfig = v.looseObject({
  transport: v.literal('stdio'),
  command: v.string(),
  args: v.optional(v.array(v.string())),
  env: v.optional(v.record(v.string(), v.string())),
})

/** 一台声明出来的服务器，变成协议认得的那个对象。认不出就是 undefined。 */
export function mcpServerWireOf(
  name: string,
  config: Readonly<Record<string, unknown>>,
): McpServerWire | undefined {
  const http = v.safeParse(HttpConfig, config)

  if (http.success) {
    const headers = http.output.headers

    return {
      type: http.output.transport,
      name,
      url: http.output.url,
      ...(headers === undefined ? {} : { headers }),
    }
  }

  const stdio = v.safeParse(StdioConfig, config)

  if (stdio.success) {
    return {
      name,
      command: stdio.output.command,
      args: stdio.output.args ?? [],
      env: Object.entries(stdio.output.env ?? {}).map(([key, value]) => ({
        name: key,
        value,
      })),
    }
  }

  return undefined
}

/** 这一台这一次送不送得出去。stdio 是基线，两个可选传输由能力位说了算。 */
export function transportIsOffered(server: McpServerWire, transports: McpTransports): boolean {
  if (!('type' in server)) {
    return true
  }

  return server.type === 'http' ? transports.http : transports.sse
}
