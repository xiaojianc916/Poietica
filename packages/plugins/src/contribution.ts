import { type InstalledPlugin, resolutionOrder } from './installation'
import { type PluginDiagnostic, SESSION_PROMPT_BUDGET_BYTES, utf8ByteLength } from './manifest'
import type { DeclaredMcpServer } from './mcp-config'
import { type McpServerWire, mcpServerWireOf } from './mcp-server'
import type { ContributionOrigin } from './origin'

/*
 * 一次遍历，两个读者。
 *
 * 管理界面要看见全部：关掉的插件、关掉的服务器都得留在列表里，否则拨到关就再也
 * 开不回来 —— 上一版就是这样，关掉一台 MCP 服务器，它从 MCP 那一格消失，开关无处
 * 可寻。会话要的是「真的会生效的那些」。所以这里一次产出全部，每一条带上自己的
 * 启用位，会话读 active 那一档（apps/desktop 的 plugins/plugin-runtime 里那个
 * activeMcpServers 就是那一档的唯一读者）。不是两条管线，是一份结果加一个显式过滤。
 *
 * 每一条都说得出自己从哪来。插件是来源之一，不是唯一 —— 这台机器上的 mcp.json 里
 * 那些服务器和插件带来的那些是同一种东西，因此走同一个列表，而不是界面上另起一格
 * 自己去合并。
 *
 * 技能与代理两类在清单里仍然只是一条 ./ 路径，路径下那些文件才是真正的实体；这一层
 * 如实交出路径，不凭空造出名字来撑版面。
 */

export interface ResolvedRoot {
  readonly origin: ContributionOrigin
  /* 清单里声明的 ./ 路径。 */
  readonly path: string
  readonly enabled: boolean
}

export interface ResolvedMcpServer {
  readonly origin: ContributionOrigin
  readonly name: string
  /*
   * 协议认得的那个对象。配置里那一格的写法归 MCP 规范所有，解码在这一层做完，
   * 下游拿到的就是能直接上线的形状。
   *
   * undefined 表示这台的传输本程序认不出。它照样留在列表里，因为开关要有落脚点。
   */
  readonly wire: McpServerWire | undefined
  /** 这一台自己的开关。界面上那个 Switch 显示的就是它。 */
  readonly enabled: boolean
  /** 本应用会在会话开始时启动它。 */
  readonly active: boolean
}

export interface ResolvedPrompt {
  /* 提示词只有插件声明得出来，所以这一条不需要来源这一维。 */
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
  /** 这台机器上已经配好的那些服务器。本应用只读，不写。 */
  readonly environment: readonly DeclaredMcpServer[]
}

export function resolveContributions(input: ContributionInput): ResolvedContributions {
  const skillRoots: ResolvedRoot[] = []
  const agentRoots: ResolvedRoot[] = []
  const commandRoots: ResolvedRoot[] = []
  const mcpServers: ResolvedMcpServer[] = []
  const prompts: ResolvedPrompt[] = []
  const diagnostics: PluginDiagnostic[] = []

  let promptBytes = 0

  /* 机器上那些排在前面：它们先于任何插件存在，界面上也是这个次序。 */
  collectEnvironmentServers(input.environment, mcpServers)

  for (const plugin of resolutionOrder(input.plugins)) {
    const origin: ContributionOrigin = { kind: 'plugin', pluginId: plugin.manifest.name }

    diagnostics.push(...plugin.diagnostics)

    collectRoots(origin, plugin.manifest.skillRoots, plugin.enabled, skillRoots)
    collectRoots(origin, plugin.manifest.agentRoots, plugin.enabled, agentRoots)
    collectRoots(origin, plugin.manifest.commandRoots, plugin.enabled, commandRoots)
    collectMcpServers(plugin, origin, mcpServers, diagnostics)

    promptBytes = collectPrompt(plugin, promptBytes, prompts, diagnostics)
  }

  return { agentRoots, commandRoots, diagnostics, mcpServers, promptBytes, prompts, skillRoots }
}

function collectRoots(
  origin: ContributionOrigin,
  paths: readonly string[],
  enabled: boolean,
  into: ResolvedRoot[],
): void {
  for (const declared of paths) {
    into.push({ origin, path: declared, enabled })
  }
}

/*
 * 机器上那份 mcp.json 里的服务器。
 *
 * active 恒假，而且这不是保守起见：装载它们的是那台 CLI 自己，本应用没有起过它们。
 * 写成真会让界面说一句本应用做不到的话。同理这里不记诊断 —— 那份文件不归本应用所有，
 * 认不出的传输由界面在那一行上说明，而不是变成一条挂在某个插件名下的诊断。
 */
function collectEnvironmentServers(
  declared: readonly DeclaredMcpServer[],
  into: ResolvedMcpServer[],
): void {
  for (const server of declared) {
    into.push({
      origin: server.origin,
      name: server.name,
      wire: mcpServerWireOf(server.name, server.config),
      enabled: server.enabledInConfig,
      active: false,
    })
  }
}

/* 关掉的那几台照样列出来，只是 active 是假 —— 不然开关就没有落脚点。 */
function collectMcpServers(
  plugin: InstalledPlugin,
  origin: ContributionOrigin,
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
        detail: `"${server.name}"·的传输方式无法识别，本次会话没有装载它`,
      })
    }

    into.push({
      origin,
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
