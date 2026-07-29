import type { AcpAgentProfile } from '@poietica/agent-registry'

/**
 * 一次受控的 agent CLI 调用。
 *
 * 没有 home 相关的字段：受控 home 由原生侧的 launch_env 现算，与 ACP 会话
 * 共用同一个产地。渲染层报一个路径过去，只会得到两条各自算出不同目录的
 * 管线，而那种错误在界面上表现为「明明配好了，模型列表却是空的」。
 */
export interface AgentCliInvocation {
  readonly agentId: string
  /**
   * 完整的子命令序列，例如 ['provider', 'list', '--json']。
   *
   * 第一项是子命令名，原生侧的白名单看的就是它。
   *
   * 可执行文件不在这里，与 home 同理：由原生侧按 agentId 从档案里取。渲染层
   * 报一个程序路径过去，而白名单只校验参数，那等于放行任意程序。
   */
  readonly args: readonly string[]
  /** 要注入的凭据环境变量名。它不是秘密，只是个名字。 */
  readonly secretVar: string
  /**
   * 凭据本身。
   *
   * 它只活到这次调用结束：注入子进程后，agent 的 CLI 把它写进 agent 自己的
   * 配置文件，两端都不留副本。所以「配没配过」不能问我们 —— 要问 agent 的
   * provider list。
   */
  readonly secretValue: string
}

export interface AgentCliOutcome {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

export interface AgentConfigSnapshot {
  readonly agents: readonly AcpAgentProfile[]
  readonly defaultAgentId: string
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
 * 候选模型也一样：agent 自己就会拉 models.dev，而写入要过它的校验，所以「有哪些
 * 模型可加」问它的 provider catalog list，不在这里存第二份目录。
 *
 * 密钥不存在这里，也不存在别处。它随 execCli 的一次调用交给 agent 的 CLI，写进
 * agent 自己的配置文件之后就与我们无关 —— 那份文件里它是明文，所以我们再存一份
 * 副本换不到安全，只换来一个要同步的第二处真相。
 */
export interface AgentConfigStore {
  readonly load: () => Promise<AgentConfigSnapshot>
  readonly saveAgents: (args: {
    readonly agents: readonly AcpAgentProfile[]
    readonly defaultAgentId: string
  }) => Promise<AgentConfigSnapshot>
  /*
   * setSecret、clearSecret 与 migrateSecret 曾在这里。三者都在维护一份我们保
   * 护不了的副本 —— 理由见上面那段。migrateSecret 更是把钥匙串的旧账户名搬到
   * 新账户名，一个只为兼容自己上一版而存在的方法。
   */
  readonly clearLegacyProviders: () => Promise<AgentConfigSnapshot>
  readonly execCli: (invocation: AgentCliInvocation) => Promise<AgentCliOutcome>
}
