import { describe, expect, it } from 'vitest'
import { resolveContributions } from './contribution'
import type { InstalledPlugin } from './installation'
import type { PluginMcpServerDeclaration } from './manifest'

interface PluginParts {
  readonly enabled?: boolean
  readonly installedAt?: string
  readonly skillRoots?: readonly string[]
  readonly commandRoots?: readonly string[]
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
      capabilities: [],
      skillRoots: parts.skillRoots ?? [],
      agentRoots: [],
      commandRoots: parts.commandRoots ?? [],
      mcpServers: parts.mcpServers ?? [],
      sessionStartSkill: undefined,
      skillInstructions: undefined,
      promptSources: [],
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

describe('resolveContributions', () => {
  it('关掉的插件仍然列出来，只是不生效', () => {
    const resolved = resolveContributions({
      plugins: [plugin('demo', { enabled: false, skillRoots: ['./skills'] })],
    })

    expect(resolved.skillRoots).toEqual([{ pluginId: 'demo', path: './skills', enabled: false }])
  })

  it('单独关掉的服务器留在列表里，开关因此有落脚点', () => {
    const resolved = resolveContributions({
      plugins: [
        plugin('demo', {
          mcpServers: [
            { name: 'on', config: {} },
            { name: 'off', config: {} },
          ],
          disabledMcpServers: ['off'],
        }),
      ],
    })

    expect(resolved.mcpServers.map((server) => server.name)).toEqual(['on', 'off'])
    expect(resolved.mcpServers.map((server) => server.enabled)).toEqual([true, false])
    expect(resolved.mcpServers.map((server) => server.active)).toEqual([true, false])
  })

  it('插件关掉时服务器自己的开关不变，只是不启动', () => {
    const resolved = resolveContributions({
      plugins: [plugin('demo', { enabled: false, mcpServers: [{ name: 'one', config: {} }] })],
    })

    expect(resolved.mcpServers[0]?.enabled).toBe(true)
    expect(resolved.mcpServers[0]?.active).toBe(false)
  })

  it('命令目录原样交出，不被当成命令名', () => {
    const resolved = resolveContributions({
      plugins: [plugin('vercel-plugin', { commandRoots: ['./commands'] })],
    })

    expect(resolved.commandRoots.map((root) => root.path)).toEqual(['./commands'])
  })

  it('会话提示词预算耗尽时丢的是后来者，且与输入顺序无关', () => {
    const filler = 'x'.repeat(30 * 1024)
    const resolved = resolveContributions({
      plugins: [
        plugin('c', { installedAt: '2026-01-03T00:00:00.000Z', systemPromptText: filler }),
        plugin('a', { installedAt: '2026-01-01T00:00:00.000Z', systemPromptText: filler }),
        plugin('b', { installedAt: '2026-01-02T00:00:00.000Z', systemPromptText: filler }),
      ],
    })

    expect(resolved.prompts.map((prompt) => prompt.pluginId)).toEqual(['a', 'b'])
    expect(resolved.promptBytes).toBe(60 * 1024)
    expect(resolved.diagnostics.map((item) => item.code)).toEqual(['prompt-budget-exhausted'])
  })
})
