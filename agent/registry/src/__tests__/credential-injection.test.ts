import { describe, expect, it } from 'vitest'
import type { AcpAgentProfile } from '../acp-agent-profile'
import { redactEnv, resolveAgentLaunchEnv } from '../credential-injection'
import type { ModelProviderProfile } from '../model-provider-profile'

const provider: ModelProviderProfile = {
  id: 'zhipu',
  displayName: '智谱 GLM',
  dialect: 'anthropic',
  baseUrl: 'https://open.bigmodel.cn/api/anthropic',
  models: ['glm-4.6'],
  favoriteModels: ['glm-4.6'],
  defaultModel: 'glm-4.6',
}

const profile: AcpAgentProfile = {
  id: 'claude',
  displayName: 'Claude Code',
  command: 'claude-code-acp',
  args: [],
  cwd: undefined,
  env: {},
  credentialBinding: {
    providerId: 'zhipu',
    apiKeyEnv: 'ANTHROPIC_AUTH_TOKEN',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    modelEnv: 'ANTHROPIC_MODEL',
  },
  defaultConfigOptions: {},
}

describe('resolveAgentLaunchEnv', () => {
  it('注入 base URL、密钥与默认模型', () => {
    const result = resolveAgentLaunchEnv({ profile, provider, apiKey: 'sk-secret' })

    expect(result.env['ANTHROPIC_BASE_URL']).toBe(provider.baseUrl)
    expect(result.env['ANTHROPIC_AUTH_TOKEN']).toBe('sk-secret')
    expect(result.env['ANTHROPIC_MODEL']).toBe('glm-4.6')
    expect(result.blockers).toEqual([])
  })

  it('缺少密钥时报告原因而不是静默启动', () => {
    const result = resolveAgentLaunchEnv({ profile, provider, apiKey: undefined })

    expect(result.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()
    expect(result.blockers).toHaveLength(1)
  })

  it('档案里手写的 env 覆盖自动注入的值', () => {
    const overridden = { ...profile, env: { ANTHROPIC_BASE_URL: 'https://example.test' } }
    const result = resolveAgentLaunchEnv({ profile: overridden, provider, apiKey: 'sk-secret' })

    expect(result.env['ANTHROPIC_BASE_URL']).toBe('https://example.test')
  })

  it('未绑定提供方的 agent 自行认证', () => {
    const unbound = { ...profile, credentialBinding: undefined }
    const result = resolveAgentLaunchEnv({ profile: unbound, provider, apiKey: 'sk-secret' })

    expect(result.env).toEqual({})
    expect(result.blockers).toHaveLength(1)
  })
})

describe('redactEnv', () => {
  it('抹掉密钥但保留其他变量', () => {
    const redacted = redactEnv({
      ANTHROPIC_AUTH_TOKEN: 'sk-secret',
      ANTHROPIC_BASE_URL: 'https://example.test',
      HOME: '/home/dev',
    })

    expect(redacted['ANTHROPIC_AUTH_TOKEN']).toBe('[REDACTED]')
    expect(redacted['ANTHROPIC_BASE_URL']).toBe('https://example.test')
    expect(redacted['HOME']).toBe('/home/dev')
  })
})
