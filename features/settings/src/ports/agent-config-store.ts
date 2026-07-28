import type { AcpAgentProfile, ModelProviderProfile } from '@poietica/agent-registry'

/**
 * 某个提供方的密钥状态。
 *
 * 只有"配没配"，没有值：密钥存在系统钥匙串里，界面永远不需要、也拿不到明文。
 */
export interface ProviderSecretState {
  readonly providerId: string
  readonly configured: boolean
}

export interface AgentConfigSnapshot {
  readonly providers: readonly ModelProviderProfile[]
  readonly agents: readonly AcpAgentProfile[]
  readonly defaultAgentId: string
  readonly secrets: readonly ProviderSecretState[]
  /** 配置文件里被丢弃的坏条目。界面应该显示出来，而不是假装配置是干净的。 */
  readonly issues: readonly string[]
}

/**
 * 模型提供方与 ACP agent 的持久化端口。
 *
 * 落在独立的 agents.json，不进 AppSettings：agent 接入是设备级的运行环境配置，
 * 跟主题、快捷键这类偏好不是同一种东西，混在一起会让两边的迁移都变难。
 *
 * 密钥只单向下行：setProviderSecret 传值进去，读回来只有 configured。
 */
export interface AgentConfigStore {
  readonly load: () => Promise<AgentConfigSnapshot>
  readonly saveProviders: (
    providers: readonly ModelProviderProfile[],
  ) => Promise<AgentConfigSnapshot>
  readonly saveAgents: (args: {
    readonly agents: readonly AcpAgentProfile[]
    readonly defaultAgentId: string
  }) => Promise<AgentConfigSnapshot>
  readonly setProviderSecret: (args: {
    readonly providerId: string
    readonly value: string
  }) => Promise<AgentConfigSnapshot>
  readonly clearProviderSecret: (args: {
    readonly providerId: string
  }) => Promise<AgentConfigSnapshot>
}
