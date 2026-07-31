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
  /**
   * 从用户全局配置里取哪家 provider 的密钥来注入。只为一次性导入使用：
   * 密钥由原生侧取出直达子进程，不进渲染层。与 secretValue 互斥。
   */
  readonly secretFromGlobalProvider?: string
  /**
   * 从这个 agent 自己的受控配置里取哪家 provider 的密钥来注入。
   *
   * 为改写顶层 default_model 服务：上游唯一能写它的出口是
   * `provider catalog add --default-model`，而那条命令先删后建，重放它要把这一家
   * 原有的密钥再交一次。密钥由原生侧取出直达子进程 —— 所以改一个默认模型不需要
   * 用户重输密钥，界面也始终看不见它。
   *
   * 与 secretValue、secretFromGlobalProvider 三者互斥。
   */
  readonly secretFromAgentProvider?: string
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
  /** 每个已配置 provider 的密钥尾号。只读现算，尽力而为：取不到就是空表。 */
  readonly loadKeyTails: (agentId: string) => Promise<Record<string, string>>
  /**
   * 受控 home 里当前的默认模型；没设过就是 null。
   *
   * 它是 ACP 鉴权闸门的第一个条件，也是对方 `provider list --json` 唯一不给的
   * 那一项（非 json 分支才打印 Default model）。模型清单仍然来自 provider list。
   */
  readonly loadDefaultModel: (agentId: string) => Promise<string | null>
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

    loadKeyTails: (agentId) => invoke<Record<string, string>>('agent_key_tails', { agentId }),

    loadDefaultModel: (agentId) => invoke<string | null>('agent_default_model', { agentId }),
  }
}
