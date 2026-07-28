import type { AcpAgentProfile } from './acp-agent-profile'
import type { ModelProviderProfile } from './model-provider-profile'

export interface LaunchEnvInput {
  readonly profile: AcpAgentProfile
  /** 绑定的提供方。未绑定或找不到时传 undefined。 */
  readonly provider?: ModelProviderProfile | undefined
  /** 从系统钥匙串取出的密钥。没有配置时传 undefined。 */
  readonly apiKey?: string | undefined
}

export interface LaunchEnvResult {
  readonly env: Readonly<Record<string, string>>
  /**
   * 没能注入的原因，用于界面上诚实地解释"为什么这个 agent 还是用不了"。
   * 空数组表示一切就绪。
   */
  readonly blockers: readonly string[]
}

const SECRET_NAME_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/

/**
 * 计算启动一个 agent 时应该注入的环境变量。
 *
 * 纯函数：不读钥匙串、不读进程环境、不发请求。密钥由调用方取好传进来，
 * 这样这段逻辑可以被完整测试，也不会有人不小心把它挪到日志里。
 *
 * 覆盖顺序：档案里手写的 env 优先级最高。用户显式写下的值不应该被我们
 * 自动推导出来的值悄悄盖掉。
 */
export function resolveAgentLaunchEnv(input: LaunchEnvInput): LaunchEnvResult {
  const { profile, provider, apiKey } = input
  const binding = profile.credentialBinding

  if (!binding) {
    return {
      env: { ...profile.env },
      blockers: ['该 agent 自行管理认证，未绑定模型提供方'],
    }
  }

  if (!provider) {
    return {
      env: { ...profile.env },
      blockers: [`绑定的模型提供方不存在：${binding.providerId}`],
    }
  }

  const blockers: string[] = []
  const injected: Record<string, string> = {}

  injected[binding.baseUrlEnv] = provider.baseUrl

  if (apiKey !== undefined && apiKey.length > 0) {
    injected[binding.apiKeyEnv] = apiKey
  } else {
    blockers.push(`尚未为 ${provider.displayName} 配置密钥`)
  }

  if (binding.modelEnv !== undefined && provider.defaultModel !== undefined) {
    injected[binding.modelEnv] = provider.defaultModel
  }

  return { env: { ...injected, ...profile.env }, blockers }
}

/**
 * 抹掉环境变量里的密钥，用于日志与错误信息。
 *
 * 抄自 Zed 的 redact_command：agent 启动失败时最想看的就是完整命令，
 * 而那恰好是最容易把密钥写进日志的时刻。
 */
export function redactEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  const redacted: Record<string, string> = {}

  for (const [name, value] of Object.entries(env)) {
    const secret = SECRET_NAME_PATTERN.test(name) && value.length > 0

    redacted[name] = secret ? '[REDACTED]' : value
  }

  return redacted
}
