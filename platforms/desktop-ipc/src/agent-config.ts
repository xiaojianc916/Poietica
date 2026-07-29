import { invoke } from './invoke'

/** Whether a provider's API key is stored in the system keychain. */
export interface ProviderSecretState {
  readonly providerId: string
  readonly configured: boolean
}

/**
 * Full agent configuration snapshot returned by every agent-config command.
 *
 * providers 与 agents 是不透明对象，由 @poietica/agent-registry 在 TS 侧校验；
 * Rust 侧只负责原样存取，不解释任何字段。
 */
export interface AgentConfigSnapshot {
  readonly providers: readonly unknown[]
  readonly agents: readonly unknown[]
  readonly defaultAgentId: string
  readonly secrets: readonly ProviderSecretState[]
  /** agents.json 中解析失败、已被丢弃的条目。 */
  readonly issues: readonly string[]
}

/** 五个 agent-config IPC 命令。 */
export interface AgentConfigBridge {
  readonly load: () => Promise<AgentConfigSnapshot>
  readonly saveProviders: (providers: readonly unknown[]) => Promise<AgentConfigSnapshot>
  readonly saveAgents: (
    agents: readonly unknown[],
    defaultAgentId: string,
  ) => Promise<AgentConfigSnapshot>
  readonly setSecret: (providerId: string, value: string) => Promise<AgentConfigSnapshot>
  readonly clearSecret: (providerId: string) => Promise<AgentConfigSnapshot>
}

export function createAgentConfigBridge(): AgentConfigBridge {
  return {
    load: () => invoke<AgentConfigSnapshot>('agent_config_get'),

    saveProviders: (providers) =>
      invoke<AgentConfigSnapshot>('agent_config_save_providers', { providers }),

    saveAgents: (agents, defaultAgentId) =>
      invoke<AgentConfigSnapshot>('agent_config_save_agents', {
        agents,
        defaultAgentId,
      }),

    setSecret: (providerId, value) =>
      invoke<AgentConfigSnapshot>('agent_config_set_secret', {
        providerId,
        value,
      }),

    clearSecret: (providerId) =>
      invoke<AgentConfigSnapshot>('agent_config_clear_secret', { providerId }),
  }
}
