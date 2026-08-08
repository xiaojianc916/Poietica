import { describe, expect, it } from 'vitest'
import { decodePluginManifest } from './manifest'

/*
 * 用上游真实的官方清单当夹具。
 *
 * 单元测试验的是「我以为的格式」，这一组验的是「实际发出来的格式」—— 两者分开，
 * 因为出错的一直是后者：把 skills 收窄成数组、把目录版本号写成 "2"，都是拿想象
 * 中的形状去卡真实数据。这两份 JSON 逐字取自
 * MoonshotAI/kimi-code 的 plugins/official/，上游改形状时这里先红。
 */

const KIMI_WEBBRIDGE = {
  $schema: 'https://kimi.com/schemas/kimi.plugin.schema.json',
  name: 'kimi-webbridge',
  version: '1.11.3',
  description:
    'Control your real browser (with your login sessions) from Kimi Code via the local Kimi WebBridge daemon — navigate, click, type, read pages, and screenshot any website.',
  keywords: ['browser', 'webbridge', 'cdp', 'automation', 'web', 'scraping'],
  author: 'Moonshot AI',
  license: 'Proprietary',
  skills: './skills/',
  interface: {
    displayName: 'Kimi WebBridge',
    shortDescription:
      'Control your real browser from Kimi Code — navigate, click, type, and screenshot',
    developerName: 'Moonshot AI',
    websiteURL: 'https://www.kimi.com/features/webbridge',
  },
}

const KIMI_DATASOURCE = {
  name: 'kimi-datasource',
  version: '3.3.0',
  description: 'Finance, macro, enterprise, academic, and legal data tools for Kimi Code.',
  keywords: ['finance', 'data-source', 'mcp', 'legal'],
  mcpServers: {
    data: { command: 'node', args: ['./bin/kimi-datasource.mjs'], cwd: './' },
  },
  interface: {
    displayName: 'Kimi Datasource',
    shortDescription: 'Finance, macro, enterprise, academic, and legal data tools',
    developerName: 'Moonshot AI',
  },
}

function accept(raw: unknown) {
  const decoded = decodePluginManifest(raw)

  if (decoded.kind !== 'accepted') {
    throw new Error(`这份清单应当被接受：${decoded.diagnostics.map((d) => d.detail).join('; ')}`)
  }

  return decoded
}

describe('上游官方清单', () => {
  it('kimi-webbridge 的 skills 是一条目录路径，不是数组', () => {
    expect(accept(KIMI_WEBBRIDGE).manifest.skills).toEqual(['./skills/'])
  })

  it('kimi-webbridge 读得出显示名与开发者', () => {
    const { manifest } = accept(KIMI_WEBBRIDGE)

    expect(manifest.displayName).toBe('Kimi WebBridge')
    expect(manifest.developerName).toBe('Moonshot AI')
  })

  it('$schema、author、license 这些我们不认的键不影响接受', () => {
    expect(accept(KIMI_WEBBRIDGE).diagnostics).toEqual([])
  })

  it('kimi-datasource 的 mcpServers 展开成有名字的一条', () => {
    expect(accept(KIMI_DATASOURCE).manifest.mcpServers).toEqual([
      { name: 'data', config: { command: 'node', args: ['./bin/kimi-datasource.mjs'], cwd: './' } },
    ])
  })

  it('没写 skills 就是空的，不是缺省的 undefined', () => {
    expect(accept(KIMI_DATASOURCE).manifest.skills).toEqual([])
  })

  it('skills 写成数组同样成立', () => {
    expect(accept({ name: 'x', skills: ['a.md', 'b.md'] }).manifest.skills).toEqual([
      'a.md',
      'b.md',
    ])
  })
})
