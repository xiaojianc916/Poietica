import type { AcpAgentProfile } from '@poietica/agent-registry'

/**
 * 某个 agent 的某个凭据变量的状态。
 *
 * 只有「配没配」，没有值：密钥存在系统钥匙串里，界面永远不需要、也拿不到明文。
 *
 * 主键是 agent 加变量名，不是 provider：模式 B 下每个 agent 各自管理自己的
 * provider 表，同一个 DeepSeek key 在两个 agent 下就是两条独立记录。把它们合成
 * 一条，只会得到「在 A 里改了 key，B 悄悄跟着变」这种没人想要的行为。
 */
export interface AgentSecretState {
  readonly agentId: string
  readonly varName: string
  readonly configured: boolean
}

export interface AgentCliInvocation {
  readonly agentId: string
  readonly command: string
  readonly args: readonly string[]
  /** 要注入的凭据环境变量名。留空表示这次调用不需要凭据。 */
  readonly secretVar: string
  /** 数据根目录的环境变量名，例如 KIMI_CODE_HOME。留空表示不设置。 */
  readonly homeVar: string
  readonly homeDir: string
}

export interface AgentCliOutcome {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

export interface AgentConfigSnapshot {
  readonly agents: readonly AcpAgentProfile[]
  readonly defaultAgentId: string
  readonly secrets: readonly AgentSecretState[]
  /** models.dev 目录缓存的原始响应体。未拉取过时为 null。 */
  readonly catalog: unknown
  readonly catalogFetchedAt: string
  /** 旧版顶层 provider 列表，仅供一次性迁移。迁移完应清空。 */
  readonly legacyProviders: readonly unknown[]
  /** 配置文件里被丢弃的坏条目。界面应该显示出来，而不是假装配置是干净的。 */
  readonly issues: readonly string[]
}

/**
 * ACP agent 接入配置的持久化端口。
 *
 * 落在独立的 agents.json，不进 AppSettings：agent 接入是设备级的运行环境配置，
 * 跟主题、快捷键这类偏好不是同一种东西，混在一起会让两边的迁移都变难。
 *
 * 模式 B 下，模型与 provider 的权威副本在各 agent 自己的配置文件里，由 agent
 * 进程自己 watch 并热重载 —— 所以这里没有「保存 provider」这个动作，写入统一
 * 经由 execCli 调用 agent 官方 CLI。我们不自己拼对方的配置文件格式。
 *
 * 密钥只单向下行：setSecret 传值进去，读回来只有 configured。
 */
export interface AgentConfigStore {
  readonly load: () => Promise<AgentConfigSnapshot>
  readonly saveAgents: (args: {
    readonly agents: readonly AcpAgentProfile[]
    readonly defaultAgentId: string
  }) => Promise<AgentConfigSnapshot>
  readonly saveCatalog: (args: {
    readonly catalog: unknown
    readonly fetchedAt: string
  }) => Promise<AgentConfigSnapshot>
  readonly setSecret: (args: {
    readonly agentId: string
    readonly varName: string
    readonly value: string
  }) => Promise<AgentConfigSnapshot>
  readonly clearSecret: (args: {
    readonly agentId: string
    readonly varName: string
  }) => Promise<AgentConfigSnapshot>
  /** 把旧的 provider:{id} 密钥搬到 agent:{id}:{var}。重复调用是安全的。 */
  readonly migrateSecret: (args: {
    readonly providerId: string
    readonly agentId: string
    readonly varName: string
  }) => Promise<AgentConfigSnapshot>
  readonly clearLegacyProviders: () => Promise<AgentConfigSnapshot>
  readonly execCli: (invocation: AgentCliInvocation) => Promise<AgentCliOutcome>
}
