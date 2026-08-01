import { describe, expect, it } from 'vitest'
import { agentProviderCatalogAddArgs } from '../agent-provider-catalog'

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
        providerId: 'deepseek',
        defaultModelId: 'deepseek-v4-pro',
        baseUrl: 'https://api.deepseek.com',
      }),
    ).toEqual([
      'provider',
      'catalog',
      'add',
      'deepseek',
      '--default-model',
      'deepseek-v4-pro',
      '--base-url',
      'https://api.deepseek.com',
    ])
  })

  /*
   * 这条是这个函数存在的理由之一。原生侧的 FORBIDDEN_FLAGS 会拒掉 --api-key，因为
   * Windows 上任何用户都读得到别的进程的完整命令行。参数由这里构造，就不会有人在调用点
   * 顺手拼一个上去。
   */
  it('永远不会产出 --api-key', () => {
    const args = agentProviderCatalogAddArgs({
      providerId: 'deepseek',
      defaultModelId: 'deepseek-v4-pro',
      baseUrl: 'https://api.deepseek.com',
    })

    expect(args.join(' ')).not.toContain('--api-key')
  })

  it('拦下不能出现在命令行上的值', () => {
    expect(() => agentProviderCatalogAddArgs({ providerId: 'a;rm -rf /' })).toThrow()
    expect(() => agentProviderCatalogAddArgs({ providerId: '' })).toThrow()
    expect(() =>
      agentProviderCatalogAddArgs({ providerId: 'deepseek', defaultModelId: 'x y' }),
    ).toThrow()
  })
})
