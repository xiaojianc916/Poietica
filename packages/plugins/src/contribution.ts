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

    for (const agent of plugin.manifest.agents) {
      if (input.reservedAgentNames.has(agent.name) && !agent.override) {
        diagnostics.push({
          code: 'agent-needs-override',
          pluginId,
          detail: `${agent.name} 与内置 agent 同名，声明 override: true 之后才会生效`,
        })
        continue
      }

      agents.push({ pluginId, name: agent.name })
    }

    for (const command of plugin.manifest.commands) {
      const id = `${pluginId}:${command.name}`

      if (commandIds.has(id)) {
        diagnostics.push({
          code: 'command-name-taken',
          pluginId,
          detail: `${id} 在同一份清单里出现了两次，只保留第一条`,
        })
        continue
      }

      commandIds.add(id)
      commands.push({ pluginId, id, description: command.description, body: command.body })
    }

    for (const server of plugin.manifest.mcpServers) {
      if (plugin.disabledMcpServers.includes(server.name)) {
        continue
      }

      mcpServers.push({ pluginId, name: server.name, config: server.config })
    }

    const text = plugin.systemPromptText

    if (text === undefined) {
      continue
    }

    const bytes = utf8ByteLength(text)

    if (promptBytes + bytes > SESSION_PROMPT_BUDGET_BYTES) {
      diagnostics.push({
        code: 'prompt-budget-exhausted',
        pluginId,
        detail: `会话提示词预算 ${SESSION_PROMPT_BUDGET_BYTES} 字节已用尽，这一段没有注入`,
      })
      continue
    }

    promptBytes += bytes
    prompts.push({ pluginId, text, bytes })
  }

  return { agents, commands, diagnostics, mcpServers, promptBytes, prompts, skills }
}
