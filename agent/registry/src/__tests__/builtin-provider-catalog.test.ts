import { describe, expect, it } from 'vitest'
import {
  agentBareModelId,
  agentProviderCatalogDocument,
  builtinAgentProviderById,
  builtinAgentProviders,
} from '../builtin-provider-catalog'

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

  it('声明了思考的模型带 reasoning 与 reasoning_options，档位原样进 values', () => {
    const deepseek = builtinAgentProviderById('deepseek')

    if (deepseek === undefined) {
      throw new Error('内置表缺 deepseek')
    }

    const entry = entryOf(agentProviderCatalogDocument([deepseek]), 'deepseek')
    const models = entry['models'] as Record<
      string,
      { reasoning?: unknown; reasoning_options?: readonly Record<string, unknown>[] }
    >

    expect(models['deepseek-v4-pro']?.reasoning).toBe(true)
    expect(models['deepseek-v4-pro']?.reasoning_options).toEqual([
      { type: 'effort', values: ['high', 'max'] },
      { type: 'toggle' },
    ])
  })

  it('内置表声明的推理档位全是小写', () => {
    for (const preset of builtinAgentProviders()) {
      for (const model of preset.models) {
        for (const effort of model.thinking?.efforts ?? []) {
          expect(
            effort === effort.toLowerCase(),
            `${preset.id}/${model.id} 的档位 ${effort} 不是小写 —— 档位原样进请求体，大小写是契约`,
          ).toBe(true)
        }
      }
    }
  })

  it('没声明思考的模型一个 reasoning 字段都不带', () => {
    const document = agentProviderCatalogDocument([
      {
        id: 'bare',
        displayName: '裸模型',
        description: '',
        wire: 'openai',
        baseUrl: 'https://example.com',
        apiKeysUrl: 'https://example.com',
        models: [{ id: 'bare-1', displayName: '裸 1', maxContextSize: 1024 }],
      },
    ])

    expect(document).not.toContain('reasoning')
  })
})

/*
 * 别名与裸 id 的换算。
 *
 * 判据是对方的两处逐字：校验名单里的 id 不带前缀（handleCatalogAdd 的
 * models.some((m) => m.id === opts.defaultModel)），而成功之后它自己拼回全名
 * （Default model set to ${providerId}/${opts.defaultModel}）。给错一头，
 * 整次写入以 exit 1 收场。
 */
describe('agentBareModelId', () => {
  it('剥掉 provider/ 前缀', () => {
    expect(agentBareModelId('moonshot-cn/kimi-k2.6', 'moonshot-cn')).toBe('kimi-k2.6')
  })

  it('别名本来就没带前缀时原样返回，不猜', () => {
    expect(agentBareModelId('kimi-k2.6', 'moonshot-cn')).toBe('kimi-k2.6')
  })

  it('只剥开头那一段：模型 id 自己带的斜杠不动', () => {
    expect(agentBareModelId('openrouter/moonshotai/kimi-k2', 'openrouter')).toBe(
      'moonshotai/kimi-k2',
    )
  })

  it('前缀只是碰巧同名的一段时不剥', () => {
    expect(agentBareModelId('deepseek-v4-pro', 'deepseek')).toBe('deepseek-v4-pro')
  })
})
