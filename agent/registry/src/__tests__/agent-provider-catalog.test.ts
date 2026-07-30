import { describe, expect, it } from 'vitest'
import {
  agentProviderCatalogAddArgs,
  agentProviderCatalogModelsArgs,
  parseAgentProviderCatalogModelsOutput,
} from '../agent-provider-catalog'

/*
 * 目录输出的形状上游没有给 schema，我们也还没实测。所以这里断言的是「三种可能形状都
 * 认得」，而不是「就是这一种」—— 等实测到真实形状，删掉用不上的那两条即可，而不是等
 * 界面上出现一个空下拉才发现。
 */
const nested = {
  providers: {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      api: 'https://api.openai.com/v1',
      models: {
        'gpt-5.2': { name: 'GPT-5.2', limit: { context: 400000 } },
        'gpt-5.2-mini': { name: 'GPT-5.2 mini' },
      },
    },
    anthropic: { name: 'Anthropic', models: {} },
  },
}

describe('agentProviderCatalogModelsArgs', () => {
  it('是完整的子命令序列，第一项是子命令名', () => {
    const args = agentProviderCatalogModelsArgs('openai')

    expect(args).toEqual(['provider', 'catalog', 'list', 'openai', '--json'])
    expect(args[0]).toBe('provider')
  })
})

describe('agentProviderCatalogAddArgs', () => {
  it('只给厂商时不带任何可选参数', () => {
    expect(agentProviderCatalogAddArgs({ providerId: 'anthropic' })).toEqual([
      'provider',
      'catalog',
      'add',
      'anthropic',
    ])
  })

  it('默认模型与基础地址各自可选', () => {
    expect(
      agentProviderCatalogAddArgs({
        providerId: 'anthropic',
        defaultModelId: 'claude-opus-4-7',
        baseUrl: 'https://api.anthropic.com',
      }),
    ).toEqual([
      'provider',
      'catalog',
      'add',
      'anthropic',
      '--default-model',
      'claude-opus-4-7',
      '--base-url',
      'https://api.anthropic.com',
    ])
  })

  /*
   * 这条是这个函数存在的理由之一。原生侧的 FORBIDDEN_FLAGS 会拒掉 --api-key，因为
   * Windows 上任何用户都读得到别的进程的完整命令行。参数由这里构造，就不会有人在调用点
   * 顺手拼一个上去。
   */
  it('永远不会产出 --api-key', () => {
    const args = agentProviderCatalogAddArgs({
      providerId: 'openai',
      defaultModelId: 'gpt-5.2',
      baseUrl: 'https://api.openai.com/v1',
    })

    expect(args.join(' ')).not.toContain('--api-key')
  })

  it('拦下不能出现在命令行上的值', () => {
    expect(() => agentProviderCatalogAddArgs({ providerId: 'a;rm -rf /' })).toThrow()
    expect(() => agentProviderCatalogAddArgs({ providerId: '' })).toThrow()
    expect(() =>
      agentProviderCatalogAddArgs({ providerId: 'openai', defaultModelId: 'x y' }),
    ).toThrow()
  })
})

describe('parseAgentProviderCatalogModelsOutput', () => {
  it('从 providers 表里取这一家的模型，并读出上下文窗口', () => {
    const parsed = parseAgentProviderCatalogModelsOutput(JSON.stringify(nested), 'openai')

    expect(parsed.models.map((model) => model.id)).toEqual(['gpt-5.2', 'gpt-5.2-mini'])
    expect(parsed.models[0]?.maxContextSize).toBe(400000)
    expect(parsed.issues).toHaveLength(0)
  })

  it('顶层就是 id→厂商的表也认', () => {
    const parsed = parseAgentProviderCatalogModelsOutput(
      JSON.stringify({ openai: { models: { 'gpt-5.2': {} } } }),
      'openai',
    )

    expect(parsed.models.map((model) => model.id)).toEqual(['gpt-5.2'])
  })

  it('数组形状也认，id 取条目自己的字段', () => {
    const parsed = parseAgentProviderCatalogModelsOutput(
      JSON.stringify({
        providers: [{ id: 'openai', models: [{ id: 'gpt-5.2', name: 'GPT-5.2' }] }],
      }),
      'openai',
    )

    expect(parsed.models.map((model) => model.displayName)).toEqual(['GPT-5.2'])
  })

  it('只有一张顶层 models 表时按它来', () => {
    const parsed = parseAgentProviderCatalogModelsOutput(
      JSON.stringify({ models: { 'gpt-4o': {} } }),
      'openai',
    )

    expect(parsed.models.map((model) => model.id)).toEqual(['gpt-4o'])
  })

  it('显示名缺席时退回 id', () => {
    const parsed = parseAgentProviderCatalogModelsOutput(
      JSON.stringify({ models: { bare: {} } }),
      'openai',
    )

    expect(parsed.models[0]?.displayName).toBe('bare')
    expect(parsed.models[0]?.maxContextSize).toBeUndefined()
  })

  it('空输出、坏 JSON、查无此家各记一条 issue', () => {
    expect(parseAgentProviderCatalogModelsOutput('   ', 'openai').issues).toHaveLength(1)
    expect(parseAgentProviderCatalogModelsOutput('{ not json', 'openai').issues).toHaveLength(1)
    expect(
      parseAgentProviderCatalogModelsOutput(JSON.stringify(nested), 'anthropic').issues,
    ).toHaveLength(1)
  })
})
