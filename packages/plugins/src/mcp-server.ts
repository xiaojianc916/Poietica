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
 * 输入那一侧的判别式不是 transport，是字段本身。Kimi 官方 MCP 文档原句：
 * "Entries with a `command` field are stdio servers; entries with a `url`
 * field and no `transport` are HTTP servers. For legacy SSE servers, set
 * `transport` to \"sse\" explicitly."
 *
 * 这一条不是措辞问题。官方插件 kimi-datasource 的清单里那台服务器写的是
 * { "command": "node", "args": [...], "cwd": "./" }，一个 transport 字段都没有；
 * 把 transport 当必填判别式，它就会被判成「传输方式无法识别」而整台不装载 ——
 * 照文档默认写法写的插件全中，写了 transport 的（vercel-plugin）反而没事。
 *
 * 插件清单与 mcp.json 用的是同一套写法（文档：plugin 的 mcpServers 复用 MCP 的
 * schema），所以这里是唯一一处解码，两边共用，不会有第二份跟着漂。
 * 认不出的形状不猜，交回 undefined，由调用方记一条诊断 —— 静默丢弃会把「装上了
 * 却没反应」变成查不出原因的问题。
 */

/*
 * 下面两个形状是 type 不是 interface，数组也不只读 —— 两处都是为了让「这是一
 * 份 JSON」可被编译器证明，而不是只在上面那段注释里声明。
 *
 * 传输那一格的类型由生成绑定给出：原生侧收的是 Vec<serde_json::Value>，specta
 * 出来就是 JsonValue。而 TypeScript 只给类型别名隐式索引签名，不给接口 —— 接口
 * 可以被声明合并，编译器保证不了它未来还只有这几个字段
 * （microsoft/TypeScript#15300）。JsonValue 的数组分支又是可变的，readonly 数组
 * 永远证不进去。
 *
 * 这些对象在 mcpServerWireOf 里现造、随即交给传输，没有人持有、没有人改它。
 * 那层深只读保护的是不存在的风险，换来的却是一句编译期成立的「送得出去」。
 */

export type McpServerHttpWire = {
  readonly type: 'http' | 'sse'
  readonly name: string
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
}

export type McpServerStdioWire = {
  readonly name: string
  readonly command: string
  readonly args: string[]
  readonly env: { readonly name: string; readonly value: string }[]
}

export type McpServerWire = McpServerHttpWire | McpServerStdioWire

/** 哪些传输这一次真的送得出去。由 agent 握手时自己说。 */
export interface McpTransports {
  readonly http: boolean
  readonly sse: boolean
}

/* url 那一支：没写 transport 就是 http，写了 sse 才是那条老通道。 */
const HttpConfig = v.looseObject({
  transport: v.optional(v.picklist(['http', 'sse'])),
  url: v.string(),
  headers: v.optional(v.record(v.string(), v.string())),
})

/* command 那一支：stdio 的 transport 字段可写可不写，写了也只能是 stdio。 */
const StdioConfig = v.looseObject({
  transport: v.optional(v.literal('stdio')),
  command: v.string(),
  args: v.optional(v.array(v.string())),
  env: v.optional(v.record(v.string(), v.string())),
})

/**
 * 一台声明出来的服务器，变成协议认得的那个对象。认不出就是 undefined。
 *
 * command 先看：文档把它排在前面，而且两者同时出现时子进程那一支才是能真的起来的
 * 那一支 —— url 没有命令可跑。
 */
export function mcpServerWireOf(
  name: string,
  config: Readonly<Record<string, unknown>>,
): McpServerWire | undefined {
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

  const http = v.safeParse(HttpConfig, config)

  if (http.success) {
    const headers = http.output.headers

    return {
      type: http.output.transport ?? 'http',
      name,
      url: http.output.url,
      ...(headers === undefined ? {} : { headers }),
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
