import { invoke } from './invoke'

/*
 * 同一个 agent 的配置调用排成一列。
 *
 * agent 的 config.toml 没有跨进程锁，而写它的动作有四个：保存密钥、删除密钥、一次性
 * 导入、改默认模型。前三个都是起一个 agent CLI 子进程做「读整份 → 合并 → 写回」，
 * 一次要好几秒。两个并发跑起来，后写的那个从写前状态出发 —— 上游在自己的测试里写下
 * 过这句话：a write that starts from the pre-edit state would silently drop them.
 *
 * 用户真会这么干：三张厂商卡的忙碌状态各是各的，填完一家的密钥点保存，不等它转完接着
 * 填下一家，是配置 agent 时最自然的动作。两张卡都会说「已写入」，而其中一家的密钥不在
 * 文件里，直到用那家模型时被要求登录。
 *
 * 排队放在这里，而不是把按钮灰掉：用户想做的两件事都合理，只是不该同时写。为此把一个
 * 「谁在写」的状态从页面穿到每张卡再穿到对话页，是让用户替我们的实现细节让路。
 *
 * 读也排在写后面：一次 provider list 若在写到一半时发出，读回的是写前的配置，还会被
 * 存成展示缓存。排队顺带消掉了这条。纯读的那两条命令（密钥尾号、默认模型）不排 ——
 * 原生侧写入是先写临时文件再 rename，读者永远看不到半份文件。
 *
 * 这不是文件锁，拦不住用户手改或 agent 自己写。今天所有写入都出自这一个渲染进程，
 * 所以这条链就是完整的；那个文件本来也没有更强的东西可用。
 */
const queues = new Map<string, Promise<unknown>>()

function inOrder<T>(agentId: string, work: () => Promise<T>): Promise<T> {
  const tail = queues.get(agentId) ?? Promise.resolve()
  const next = tail.then(work)

  /* 队尾永远不带失败：一次写入出错，不该把后面排着的那些一并拒掉。 */
  queues.set(
    agentId,
    next.catch(() => undefined),
  )

  return next
}

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
  /**
   * 改写受控 home 里的 default_model。
   *
   * 原地改一个键，不经 agent 的 CLI：官方那条 catalog add 是为换整份模型清单设计的，
   * 先删后建。agent 自己 watch 着配置文件，所以改完不需要重启它。
   */
  readonly saveDefaultModel: (agentId: string, alias: string) => Promise<void>
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

    execCli: (request) =>
      inOrder(request.agentId, () => invoke<AgentCliResult>('agent_cli_exec', { request })),

    loadKeyTails: (agentId) => invoke<Record<string, string>>('agent_key_tails', { agentId }),

    loadDefaultModel: (agentId) => invoke<string | null>('agent_default_model', { agentId }),

    saveDefaultModel: (agentId, alias) =>
      inOrder(agentId, () => invoke<void>('agent_set_default_model', { agentId, alias })),
  }
}
