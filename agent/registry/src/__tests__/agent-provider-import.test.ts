import { describe, expect, it } from 'vitest'
import type { AgentProviderState } from '../agent-provider-state'
import { agentProviderImportDocument } from '../agent-provider-state'

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
    expect(Object.keys(models)).toEqual(['kimi-k3', 'kimi-k2.6'])
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

  it('没有上下文的模型跳过（对方会整条丢掉，不如在这里就跳）', () => {
    expect(agentProviderImportDocument(provider)).not.toContain('bare')
  })

  it('文档里一个密钥字段都没有', () => {
    const document = agentProviderImportDocument(provider)

    expect(document).not.toContain('apiKey')
    expect(document).not.toContain('api_key')
  })
})
