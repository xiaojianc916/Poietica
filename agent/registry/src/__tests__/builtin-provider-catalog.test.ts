import { describe, expect, it } from 'vitest'
import { agentProviderCatalogDocument, builtinAgentProviders } from '../builtin-provider-catalog'

/*
 * 内置表喂给对方目录命令时必须具备的形状。
 *
 * 判据不是 models.dev 长什么样，而是对方的解析器逐字读什么（@moonshot-ai/kosong 的
 * src/catalog.ts）：type 在场就以它为准；api 是接口地址；models 表每条都要有 id 与一个
 * 正整数的 limit.context —— 缺了，catalogModelToCapability 会把那条模型整条丢掉，于是
 * --default-model 校验不过、界面上下拉是空的。
 */

function entryOf(document: string, providerId: string): Record<string, unknown> {
  const catalog = JSON.parse(document) as Record<string, Record<string, unknown>>
  const entry = catalog[providerId]

  if (entry === undefined) {
    throw new Error(`目录文档缺 ${providerId}`)
  }

  return entry
}

describe('agentProviderCatalogDocument', () => {
  it('顶层是 id → 厂商的表，条目带 type / api / models', () => {
    const preset = builtinAgentProviders()[0]

    if (preset === undefined) {
      throw new Error('内置厂商表为空')
    }

    const entry = entryOf(agentProviderCatalogDocument([preset]), preset.id)

    expect(entry['type']).toBe(preset.wire)
    expect(entry['api']).toBe(preset.baseUrl)

    const models = entry['models'] as Record<string, Record<string, unknown>>
    expect(Object.keys(models)).toEqual(preset.models.map((model) => model.id))
  })

  it('每条模型都带 id 与正整数 limit.context，缺了对方会整条丢掉', () => {
    const document = agentProviderCatalogDocument(builtinAgentProviders())
    const catalog = JSON.parse(document) as Record<
      string,
      { models?: Record<string, { id?: unknown; limit?: { context?: unknown } }> }
    >

    for (const [providerId, entry] of Object.entries(catalog)) {
      for (const [modelId, model] of Object.entries(entry.models ?? {})) {
        const label = `${providerId}/${modelId}`

        expect(model.id, label).toBe(modelId)
        expect(typeof model.limit?.context, label).toBe('number')
      }
    }
  })

  it('文档里一个密钥字段都没有', () => {
    const document = agentProviderCatalogDocument(builtinAgentProviders())

    expect(document).not.toContain('apiKey')
    expect(document).not.toContain('api_key')
  })

  it('内置表每一条模型都声明了上下文窗口', () => {
    for (const preset of builtinAgentProviders()) {
      for (const model of preset.models) {
        expect(
          typeof model.maxContextSize === 'number' && model.maxContextSize > 0,
          `${preset.id}/${model.id} 缺 maxContextSize（对方会把没有 limit.context 的模型丢掉）`,
        ).toBe(true)
      }
    }
  })
})
