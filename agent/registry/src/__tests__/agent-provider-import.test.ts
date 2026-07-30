import { describe, expect, it } from 'vitest'
import type { AgentProviderState } from '../agent-provider-state'
import { agentModelDisplayName, agentProviderImportDocument } from '../builtin-provider-catalog'

const provider: AgentProviderState = {
  id: 'moonshot-cn',
  type: 'kimi',
  baseUrl: 'https://api.moonshot.cn/v1',
  configured: true,
  credentialKind: 'apiKey',
  registryUrl: undefined,
  synthetic: false,
  models: [
    {
      alias: 'moonshot-cn/kimi-k3',
      displayName: 'kimi-k3',
      providerId: 'moonshot-cn',
      maxContextSize: 1048576,
      capabilities: ['thinking', 'always_thinking', 'image_in', 'video_in', 'tool_use'],
      supportEfforts: ['low', 'high', 'max'],
    },
    {
      alias: 'moonshot-cn/kimi-k2.6',
      displayName: 'kimi-k2.6',
      providerId: 'moonshot-cn',
      maxContextSize: 262144,
      capabilities: ['thinking', 'image_in', 'video_in', 'tool_use'],
      supportEfforts: [],
    },
    {
      alias: 'moonshot-cn/kimi-k2.5',
      displayName: 'moonshot-cn/kimi-k2.5',
      providerId: 'moonshot-cn',
      maxContextSize: 262144,
      capabilities: ['thinking', 'tool_use'],
      supportEfforts: [],
    },
    {
      alias: 'moonshot-cn/bare',
      displayName: 'bare',
      providerId: 'moonshot-cn',
      maxContextSize: undefined,
      capabilities: [],
      supportEfforts: [],
    },
  ],
}

describe('agentProviderImportDocument', () => {
  it('照 api.json 形状序列化：type、api、剥掉前缀的模型 id', () => {
    const document = JSON.parse(agentProviderImportDocument(provider)) as Record<
      string,
      Record<string, unknown>
    >
    const entry = document['moonshot-cn']

    expect(entry?.['type']).toBe('kimi')
    expect(entry?.['api']).toBe('https://api.moonshot.cn/v1')

    const models = entry?.['models'] as Record<string, unknown>
    expect(Object.keys(models)).toEqual(['kimi-k3', 'kimi-k2.6', 'kimi-k2.5'])
  })

  it('effort 与 thinking 各归各的形状', () => {
    const document = JSON.parse(agentProviderImportDocument(provider)) as Record<
      string,
      { models: Record<string, { reasoning?: unknown; reasoning_options?: unknown[] }> }
    >
    const models = document['moonshot-cn']?.models

    expect(models?.['kimi-k3']?.reasoning).toBe(true)
    expect(models?.['kimi-k3']?.reasoning_options).toEqual([
      { type: 'effort', values: ['low', 'high', 'max'] },
    ])
    expect(models?.['kimi-k2.6']?.reasoning_options).toEqual([{ type: 'toggle' }])
  })

  it('没起名的模型在写入时就补好显示名', () => {
    const document = JSON.parse(agentProviderImportDocument(provider)) as Record<
      string,
      { models: Record<string, { name?: unknown }> }
    >

    expect(document['moonshot-cn']?.models['kimi-k2.5']?.name).toBe('Kimi K2.5')
  })

  it('没有上下文的模型跳过（对方会整条丢掉，不如在这里就跳）', () => {
    expect(agentProviderImportDocument(provider)).not.toContain('bare')
  })

  it('文档里一个密钥字段都没有', () => {
    const document = agentProviderImportDocument(provider)

    expect(document).not.toContain('apiKey')
    expect(document).not.toContain('api_key')
  })
})

describe('agentModelDisplayName', () => {
  it('agent 报的名字与别名不同，以 agent 为准', () => {
    const model = provider.models[0]

    if (model === undefined) {
      throw new Error('装置缺模型')
    }

    expect(agentModelDisplayName(model)).toBe('kimi-k3')
  })

  it('没起名（名字就是别名）时查内置表补全', () => {
    const model = provider.models[2]

    if (model === undefined) {
      throw new Error('装置缺模型')
    }

    expect(agentModelDisplayName(model)).toBe('Kimi K2.5')
  })

  it('内置表不认识的厂商原样显示别名', () => {
    expect(
      agentModelDisplayName({
        alias: 'strange/thing',
        displayName: 'strange/thing',
        providerId: 'strange',
        maxContextSize: 1,
        capabilities: [],
        supportEfforts: [],
      }),
    ).toBe('strange/thing')
  })
})
