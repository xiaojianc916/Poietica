import { invoke } from './invoke'

/** 受控 CLI 调用的请求。受控 home 与可执行文件都由原生侧按 agentId 现算。 */
export interface AgentCliRequest {
  readonly agentId: string
  /** 完整的子命令序列，例如 ['provider', 'list', '--json']。 */
  readonly args: readonly string[]
  /** 要注入的凭据环境变量名。留空表示这次调用不注入凭据。 */
  readonly secretVar: string
  /** 凭据本身。只在这一次调用里用一趟，两端都不保存。 */
  readonly secretValue: string
  /**
   * api.json 形状的目录文档，只在 catalog add 时携带。
   * 原生侧把它绑在一次性 loopback 服务上，经官方 --url 喂给对方的目录命令。
   */
  readonly catalogDocument?: string
  /** 读用户全局 home 而不是受控 home。只为一次性导入的只读探测使用。 */
  readonly useGlobalHome?: boolean
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
 * 负责原样存取。
 */
export interface AgentConfigSnapshot {
  readonly agents: readonly unknown[]
  readonly defaultAgentId: string
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

    clearLegacyProviders: () => invoke<AgentConfigSnapshot>('agent_config_clear_legacy_providers'),

    execCli: (request) => invoke<AgentCliResult>('agent_cli_exec', { request }),
  }
}
