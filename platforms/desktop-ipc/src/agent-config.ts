import { invoke } from './invoke'

/** 某个 agent 的某个凭据变量是否已配置。 */
export interface AgentSecretState {
  readonly agentId: string
  readonly varName: string
  readonly configured: boolean
}

/** 受控 CLI 调用的请求。空字符串表示「这一项不需要」。 */
export interface AgentCliRequest {
  readonly agentId: string
  readonly command: string
  readonly args: readonly string[]
  readonly secretVar: string
  readonly homeVar: string
  readonly homeDir: string
}

export interface AgentCliResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * 完整的 agent 配置快照。
 *
 * agents 是不透明对象，由 @poietica/agent-registry 在 TS 侧校验；Rust 侧只
 * 负责原样存取。catalog 同理，它是 models.dev 响应体的缓存。
 */
export interface AgentConfigSnapshot {
  readonly agents: readonly unknown[]
  readonly defaultAgentId: string
  readonly secrets: readonly AgentSecretState[]
  readonly catalog: unknown
  readonly catalogFetchedAt: string
  /** 旧版顶层 provider 列表，仅供一次性迁移使用。 */
  readonly legacyProviders: readonly unknown[]
  /** agents.json 中解析失败、已被丢弃的条目。 */
  readonly issues: readonly string[]
}

export interface AgentConfigBridge {
  readonly load: () => Promise<AgentConfigSnapshot>
  readonly saveAgents: (
    agents: readonly unknown[],
    defaultAgentId: string,
  ) => Promise<AgentConfigSnapshot>
  readonly saveCatalog: (catalog: unknown, fetchedAt: string) => Promise<AgentConfigSnapshot>
  readonly setSecret: (
    agentId: string,
    varName: string,
    value: string,
  ) => Promise<AgentConfigSnapshot>
  readonly clearSecret: (agentId: string, varName: string) => Promise<AgentConfigSnapshot>
  readonly migrateSecret: (
    providerId: string,
    agentId: string,
    varName: string,
  ) => Promise<AgentConfigSnapshot>
  readonly clearLegacyProviders: () => Promise<AgentConfigSnapshot>
  readonly execCli: (request: AgentCliRequest) => Promise<AgentCliResult>
}

export function createAgentConfigBridge(): AgentConfigBridge {
  return {
    load: () => invoke<AgentConfigSnapshot>('agent_config_get'),

    saveAgents: (agents, defaultAgentId) =>
      invoke<AgentConfigSnapshot>('agent_config_save_agents', {
        agents,
        defaultAgentId,
      }),

    saveCatalog: (catalog, fetchedAt) =>
      invoke<AgentConfigSnapshot>('agent_config_save_catalog', {
        catalog,
        fetchedAt,
      }),

    setSecret: (agentId, varName, value) =>
      invoke<AgentConfigSnapshot>('agent_config_set_secret', {
        agentId,
        varName,
        value,
      }),

    clearSecret: (agentId, varName) =>
      invoke<AgentConfigSnapshot>('agent_config_clear_secret', {
        agentId,
        varName,
      }),

    migrateSecret: (providerId, agentId, varName) =>
      invoke<AgentConfigSnapshot>('agent_config_migrate_secret', {
        providerId,
        agentId,
        varName,
      }),

    clearLegacyProviders: () => invoke<AgentConfigSnapshot>('agent_config_clear_legacy_providers'),

    execCli: (request) => invoke<AgentCliResult>('agent_cli_exec', { request }),
  }
}
