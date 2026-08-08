import { type InstalledPlugin, resolutionOrder } from './installation'
import { type PluginDiagnostic, SESSION_PROMPT_BUDGET_BYTES, utf8ByteLength } from './manifest'

export interface ResolvedSkill {
  readonly pluginId: string
  readonly path: string
}

export interface ResolvedAgent {
  readonly pluginId: string
  readonly name: string
}

export interface ResolvedCommand {
  readonly pluginId: string
  /* 对外的名字带插件命名空间：两个插件都叫 review 时不会互相顶掉。 */
  readonly id: string
  readonly description: string
  readonly body: string
}

export interface ResolvedMcpServer {
  readonly pluginId: string
  readonly name: string
  readonly config: Readonly<Record<string, unknown>>
}

export interface ResolvedPrompt {
  readonly pluginId: string
  readonly text: string
  readonly bytes: number
}

export interface ResolvedContributions {
  readonly skills: readonly ResolvedSkill[]
  readonly agents: readonly ResolvedAgent[]
  readonly commands: readonly ResolvedCommand[]
  readonly mcpServers: readonly ResolvedMcpServer[]
  readonly prompts: readonly ResolvedPrompt[]
  readonly promptBytes: number
  readonly diagnostics: readonly PluginDiagnostic[]
}

export interface ContributionInput {
  readonly plugins: readonly InstalledPlugin[]
  /* 内置 agent 的名字。插件想顶掉同名的内置项，必须显式声明 override。 */
  readonly reservedAgentNames: ReadonlySet<string>
}

/*
 * 唯一一条把「装了哪些插件」变成「会话看得见什么」的管线。
 *
 * 五类贡献同一次遍历产出：再开第二条路径就意味着有一天两边说的不是同一件事。
 * 被丢掉的东西一律留下一条诊断 —— 界面上那句「为什么没生效」出自这里，而不是
 * 让用户自己猜。
 */
export function resolveContributions(input: ContributionInput): ResolvedContributions {
  const skills: ResolvedSkill[] = []
  const agents: ResolvedAgent[] = []
  const commands: ResolvedCommand[] = []
  const mcpServers: ResolvedMcpServer[] = []
  const prompts: ResolvedPrompt[] = []
  const diagnostics: PluginDiagnostic[] = []
  const commandIds = new Set<string>()

  let promptBytes = 0

  for (const plugin of resolutionOrder(input.plugins)) {
    if (!plugin.enabled) {
      continue
    }

    const pluginId = plugin.manifest.name

    diagnostics.push(...plugin.diagnostics)

    for (const skillPath of plugin.manifest.skills) {
      skills.push({ pluginId, path: skillPath })
    }

    /*
     * 仍然是同一次遍历：四段判据各自成函数，顺序、诊断、丢弃的理由一个都没改。
     * 搬出去只为让这个函数的认知复杂度回到阈值以内（biome 的
     * noExcessiveCognitiveComplexity），不是开第二条管线。
     */
    collectAgents(plugin, input.reservedAgentNames, agents, diagnostics)
    collectCommands(plugin, commandIds, commands, diagnostics)
    collectMcpServers(plugin, mcpServers)

    promptBytes = collectPrompt(plugin, promptBytes, prompts, diagnostics)
  }

  return { agents, commands, diagnostics, mcpServers, promptBytes, prompts, skills }
}

/* 与内置 agent 同名的必须显式 override；被拦下的一律留一条诊断。 */
function collectAgents(
  plugin: InstalledPlugin,
  reserved: ReadonlySet<string>,
  into: ResolvedAgent[],
  diagnostics: PluginDiagnostic[],
): void {
  const pluginId = plugin.manifest.name

  for (const agent of plugin.manifest.agents) {
    if (reserved.has(agent.name) && !agent.override) {
      diagnostics.push({
        code: 'agent-needs-override',
        pluginId,
        detail: `${agent.name} 与内置 agent 同名，声明 override: true 之后才会生效`,
      })
      continue
    }

    into.push({ pluginId, name: agent.name })
  }
}

/* 对外的名字带插件命名空间；同名重复只保留第一条，其余留诊断。 */
function collectCommands(
  plugin: InstalledPlugin,
  taken: Set<string>,
  into: ResolvedCommand[],
  diagnostics: PluginDiagnostic[],
): void {
  const pluginId = plugin.manifest.name

  for (const command of plugin.manifest.commands) {
    const id = `${pluginId}:${command.name}`

    if (taken.has(id)) {
      diagnostics.push({
        code: 'command-name-taken',
        pluginId,
        detail: `${id} 在同一份清单里出现了两次，只保留第一条`,
      })
      continue
    }

    taken.add(id)
    into.push({ pluginId, id, description: command.description, body: command.body })
  }
}

/* 被单独关掉的那几台不进会话。关掉不是错，所以这里不留诊断。 */
function collectMcpServers(plugin: InstalledPlugin, into: ResolvedMcpServer[]): void {
  const pluginId = plugin.manifest.name

  for (const server of plugin.manifest.mcpServers) {
    if (plugin.disabledMcpServers.includes(server.name)) {
      continue
    }

    into.push({ pluginId, name: server.name, config: server.config })
  }
}

/**
 * 这一份提示词进不进会话，以及进了之后预算还剩多少。
 *
 * 交回的是新的已用字节数：预算是一次遍历里累起来的一个数，谁改它就由谁说出来，
 * 不塞进一个可变对象里让调用方去猜。超预算的那一段不注入，但留一条诊断 —— 界面上
 * 那句「为什么没生效」出自这里。
 */
function collectPrompt(
  plugin: InstalledPlugin,
  used: number,
  into: ResolvedPrompt[],
  diagnostics: PluginDiagnostic[],
): number {
  const pluginId = plugin.manifest.name
  const text = plugin.systemPromptText

  if (text === undefined) {
    return used
  }

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
