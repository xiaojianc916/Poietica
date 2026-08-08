import { type InstalledPlugin, resolutionOrder } from './installation'
import { type PluginDiagnostic, SESSION_PROMPT_BUDGET_BYTES, utf8ByteLength } from './manifest'
import { type McpServerWire, mcpServerWireOf } from './mcp-server'

/*
 * 一次遍历，两个读者。
 *
 * 管理界面要看见全部：关掉的插件、关掉的服务器都得留在列表里，否则拨到关就再也
 * 开不回来 —— 上一版就是这样，关掉一台 MCP 服务器，它从 MCP 那一格消失，开关无处
 * 可寻。会话要的是「真的会生效的那些」。所以这里一次产出全部，每一条带上自己的
 * 启用位，会话读 active 那一档（apps/desktop 的 plugins/plugin-runtime 里那个
 * activeMcpServers 就是那一档的唯一读者）。不是两条管线，是一份结果加一个显式过滤。
 *
 * 技能、代理、命令三类在清单里都只是一条 ./ 路径，真正的实体是路径下那些文件。
 * 扫盘还没有实现，所以这里如实交出路径，不凭空造出名字来撑版面。
 */

export interface ResolvedRoot {
  readonly pluginId: string
  /* 清单里声明的 ./ 路径。 */
  readonly path: string
  readonly enabled: boolean
}

export interface ResolvedMcpServer {
  readonly pluginId: string
  readonly name: string
  /*
   * 协议认得的那个对象。清单里那一格的写法归 MCP 规范所有，解码在这一层做完，
   * 下游拿到的就是能直接上线的形状 —— 此前这里是 Record<string, unknown>，等于
   * 把「还没解析」当成解析结果往下发。
   *
   * undefined 表示这台的传输本程序认不出。它照样留在列表里，因为开关要有落脚点。
   */
  readonly wire: McpServerWire | undefined
  /** 这一台自己的开关。界面上那个 Switch 显示的就是它。 */
  readonly enabled: boolean
  /** 会话里真的会启动：插件开着，并且这一台开着。 */
  readonly active: boolean
}

export interface ResolvedPrompt {
  readonly pluginId: string
  readonly text: string
  readonly bytes: number
}

export interface ResolvedContributions {
  readonly skillRoots: readonly ResolvedRoot[]
  readonly agentRoots: readonly ResolvedRoot[]
  readonly commandRoots: readonly ResolvedRoot[]
  readonly mcpServers: readonly ResolvedMcpServer[]
  /* 提示词没有管理界面，它是会话的载荷而不是一个可列举的实体，所以只收启用的。 */
  readonly prompts: readonly ResolvedPrompt[]
  readonly promptBytes: number
  readonly diagnostics: readonly PluginDiagnostic[]
}

export interface ContributionInput {
  readonly plugins: readonly InstalledPlugin[]
}

export function resolveContributions(input: ContributionInput): ResolvedContributions {
  const skillRoots: ResolvedRoot[] = []
  const agentRoots: ResolvedRoot[] = []
  const commandRoots: ResolvedRoot[] = []
  const mcpServers: ResolvedMcpServer[] = []
  const prompts: ResolvedPrompt[] = []
  const diagnostics: PluginDiagnostic[] = []

  let promptBytes = 0

  for (const plugin of resolutionOrder(input.plugins)) {
    const pluginId = plugin.manifest.name

    diagnostics.push(...plugin.diagnostics)

    collectRoots(pluginId, plugin.manifest.skillRoots, plugin.enabled, skillRoots)
    collectRoots(pluginId, plugin.manifest.agentRoots, plugin.enabled, agentRoots)
    collectRoots(pluginId, plugin.manifest.commandRoots, plugin.enabled, commandRoots)
    collectMcpServers(plugin, mcpServers, diagnostics)

    promptBytes = collectPrompt(plugin, promptBytes, prompts, diagnostics)
  }

  return { agentRoots, commandRoots, diagnostics, mcpServers, promptBytes, prompts, skillRoots }
}

function collectRoots(
  pluginId: string,
  paths: readonly string[],
  enabled: boolean,
  into: ResolvedRoot[],
): void {
  for (const declared of paths) {
    into.push({ pluginId, path: declared, enabled })
  }
}

/* 关掉的那几台照样列出来，只是 active 是假 —— 不然开关就没有落脚点。 */
function collectMcpServers(
  plugin: InstalledPlugin,
  into: ResolvedMcpServer[],
  diagnostics: PluginDiagnostic[],
): void {
  const pluginId = plugin.manifest.name
  const disabled = new Set(plugin.disabledMcpServers)

  for (const server of plugin.manifest.mcpServers) {
    const enabled = !disabled.has(server.name)
    const wire = mcpServerWireOf(server.name, server.config)

    /* 认不出就说出来。与 hooks 那条同一个理由：声明了却不生效，静默等于骗人。 */
    if (wire === undefined) {
      diagnostics.push({
        code: 'mcp-transport-unrecognised',
        pluginId,
        detail:`"${server.name}"·的传输方式无法识别，本次会话没有装载它`,
      })
    }

    into.push({
      pluginId,
      name: server.name,
      wire,
      enabled,
      active: plugin.enabled && enabled,
    })
  }
}

/**
 * 这一份提示词进不进会话，以及进了之后预算还剩多少。
 *
 * 交回的是新的已用字节数：预算是一次遍历里累起来的一个数，谁改它就由谁说出来，
 * 不塞进一个可变对象里让调用方去猜。超预算的那一段不注入，但留一条诊断。
 */
function collectPrompt(
  plugin: InstalledPlugin,
  used: number,
  into: ResolvedPrompt[],
  diagnostics: PluginDiagnostic[],
): number {
  const text = plugin.systemPromptText

  if (!plugin.enabled || text === undefined) {
    return used
  }

  const pluginId = plugin.manifest.name
  const bytes = utf8ByteLength(text)

  if (used + bytes > SESSION_PROMPT_BUDGET_BYTES) {
    diagnostics.push({
      code: 'prompt-budget-exhausted',
      pluginId,
      detail: `会话提示词预算 ${SESSION_PROMPT_BUDGET_BYTES} 字节已用尽，这一段没有注入`,
    })

    return used
  }

  into.push({ pluginId, text, bytes })

  return used + bytes
}
