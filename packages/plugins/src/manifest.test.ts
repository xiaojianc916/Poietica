import { describe, expect, it } from 'vitest'
import { commandDescription, decodePluginManifest, utf8ByteLength } from './manifest'

describe('decodePluginManifest', () => {
  it('拒绝不合法的插件名', () => {
    expect(decodePluginManifest({ name: 'Not A Name' }).kind).toBe('rejected')
  })

  it('把不再支持的运行期字段记成诊断，但不因此拒收清单', () => {
    const decoded = decodePluginManifest({ name: 'demo', tools: [], inject: {} })

    expect(decoded.kind).toBe('accepted')
    expect(decoded.diagnostics.map((item) => item.code)).toEqual([
      'unsupported-field',
      'unsupported-field',
    ])
  })

  it('两个提示词来源同时存在时一个都不采信', () => {
    const decoded = decodePluginManifest({
      name: 'demo',
      systemPrompt: 'a',
      systemPromptPath: './b.md',
    })

    if (decoded.kind !== 'accepted') {
      throw new Error('清单本身是合法的，不该被拒收')
    }

    expect(decoded.manifest.systemPrompt).toEqual({ kind: 'absent' })
    expect(decoded.diagnostics[0]?.code).toBe('prompt-ambiguous')
  })

  it('displayName 缺席时回落到插件名，数组缺席时是空数组', () => {
    const decoded = decodePluginManifest({ name: 'demo' })

    if (decoded.kind !== 'accepted') {
      throw new Error('最小清单应当被接受')
    }

    expect(decoded.manifest.displayName).toBe('demo')
    expect(decoded.manifest.skills).toEqual([])
    expect(decoded.manifest.systemPrompt).toEqual({ kind: 'absent' })
  })

  it('mcpServers 从对象归一成有序数组', () => {
    const decoded = decodePluginManifest({
      name: 'demo',
      mcpServers: { github: { command: 'npx' } },
    })

    if (decoded.kind !== 'accepted') {
      throw new Error('带 mcpServers 的清单应当被接受')
    }

    expect(decoded.manifest.mcpServers).toEqual([{ name: 'github', config: { command: 'npx' } }])
  })
})

describe('utf8ByteLength', () => {
  it('按字节算而不是按码元算', () => {
    expect('插件'.length).toBe(2)
    expect(utf8ByteLength('插件')).toBe(6)
  })
})

describe('commandDescription', () => {
  it('回落到正文第一条非空行', () => {
    expect(commandDescription(undefined, '\n\n审阅这次改动\n更多')).toBe('审阅这次改动')
  })

  it('正文也是空的时候给固定文案', () => {
    expect(commandDescription(undefined, '   ')).toBe('No description provided.')
  })
})
