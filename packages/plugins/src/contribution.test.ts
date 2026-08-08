import { describe, expect, it } from 'vitest'
import { resolveContributions } from './contribution'
import type { InstalledPlugin } from './installation'
import type {
  PluginAgentDeclaration,
  PluginCommandDeclaration,
  PluginMcpServerDeclaration,
} from './manifest'

interface PluginParts {
  readonly enabled?: boolean
  readonly installedAt?: string
  readonly skills?: readonly string[]
  readonly agents?: readonly PluginAgentDeclaration[]
  readonly commands?: readonly PluginCommandDeclaration[]
  readonly mcpServers?: readonly PluginMcpServerDeclaration[]
  readonly disabledMcpServers?: readonly string[]
  readonly systemPromptText?: string
}

function plugin(name: string, parts: PluginParts = {}): InstalledPlugin {
  return {
    manifest: {
      name,
      displayName: name,
      description: undefined,
      version: undefined,
      developerName: undefined,
      homepage: undefined,
      skills: parts.skills ?? [],
      agents: parts.agents ?? [],
      commands: parts.commands ?? [],
      mcpServers: parts.mcpServers ?? [],
      systemPrompt: { kind: 'absent' },
    },
    source: { kind: 'directory', path: `/tmp/${name}` },
    trust: 'third-party',
    enabled: parts.enabled ?? true,
    installedAt: parts.installedAt ?? '2026-01-01T00:00:00.000Z',
    systemPromptText: parts.systemPromptText,
    disabledMcpServers: parts.disabledMcpServers ?? [],
    diagnostics: [],
  }
}

const reservedAgentNames = new Set(['planner'])

describe('resolveContributions', () => {
  it('关掉的插件什么都不贡献', () => {
    const resolved = resolveContributions({
      plugins: [plugin('demo', { enabled: false, skills: ['./s.md'] })],
      reservedAgentNames,
    })

    expect(resolved.skills).toEqual([])
  })

  it('命令带插件命名空间，同名不互相顶掉', () => {
    const resolved = resolveContributions({
      plugins: [
        plugin('alpha', { commands: [{ name: 'review', description: 'a', body: '' }] }),
        plugin('beta', { commands: [{ name: 'review', description: 'b', body: '' }] }),
      ],
      reservedAgentNames,
    })

    expect(resolved.commands.map((command) => command.id)).toEqual(['alpha:review', 'beta:review'])
  })

  it('同一份清单里重复的命令名只保留第一条', () => {
    const resolved = resolveContributions({
      plugins: [
        plugin('demo', {
          commands: [
            { name: 'review', description: 'first', body: '' },
            { name: 'review', description: 'second', body: '' },
          ],
        }),
      ],
      reservedAgentNames,
    })

    expect(resolved.commands).toHaveLength(1)
    expect(resolved.commands[0]?.description).toBe('first')
    expect(resolved.diagnostics[0]?.code).toBe('command-name-taken')
  })

  it('单独关掉的 MCP 服务器不进结果，插件其余部分照常生效', () => {
    const resolved = resolveContributions({
      plugins: [
        plugin('demo', {
          skills: ['./s.md'],
          mcpServers: [
            { name: 'on', config: {} },
            { name: 'off', config: {} },
          ],
          disabledMcpServers: ['off'],
        }),
      ],
      reservedAgentNames,
    })

    expect(resolved.mcpServers.map((server) => server.name)).toEqual(['on'])
    expect(resolved.skills).toHaveLength(1)
  })

  it('与内置 agent 同名且没声明 override 的不生效', () => {
    const resolved = resolveContributions({
      plugins: [plugin('demo', { agents: [{ name: 'planner', override: false }] })],
      reservedAgentNames,
    })

    expect(resolved.agents).toEqual([])
    expect(resolved.diagnostics[0]?.code).toBe('agent-needs-override')
  })

  it('声明了 override 就能顶掉同名内置项', () => {
    const resolved = resolveContributions({
      plugins: [plugin('demo', { agents: [{ name: 'planner', override: true }] })],
      reservedAgentNames,
    })

    expect(resolved.agents).toEqual([{ pluginId: 'demo', name: 'planner' }])
  })

  it('会话提示词预算耗尽时丢的是后来者，且与输入顺序无关', () => {
    const filler = 'x'.repeat(30 * 1024)
    const resolved = resolveContributions({
      plugins: [
        plugin('c', { installedAt: '2026-01-03T00:00:00.000Z', systemPromptText: filler }),
        plugin('a', { installedAt: '2026-01-01T00:00:00.000Z', systemPromptText: filler }),
        plugin('b', { installedAt: '2026-01-02T00:00:00.000Z', systemPromptText: filler }),
      ],
      reservedAgentNames,
    })

    expect(resolved.prompts.map((prompt) => prompt.pluginId)).toEqual(['a', 'b'])
    expect(resolved.promptBytes).toBe(60 * 1024)
    expect(resolved.diagnostics.map((item) => item.code)).toEqual(['prompt-budget-exhausted'])
  })
})
