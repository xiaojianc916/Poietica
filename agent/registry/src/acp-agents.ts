/**
 * 可用的 ACP agent，以及启动它们的方式。
 *
 * 这是"支持哪个 agent"的唯一答案。原生侧不再内置任何默认命令，所以
 * 增加一个 agent 是往这张表里加一行，而不是改 Rust 里的一个常量。
 * 表里的每一项都只描述 ACP 之内的事：协议之外的特性不属于这里。
 */

export interface AcpAgentDescriptor {
  readonly id: string
  readonly displayName: string
  /** 启动它的命令行。 */
  readonly command: string
}

const AGENTS: readonly AcpAgentDescriptor[] = [
  { id: 'kimi', displayName: 'Kimi Code', command: 'kimi acp' },
]

export function acpAgents(): readonly AcpAgentDescriptor[] {
  return AGENTS
}

/** 未指明时启动哪一个。表为空是配置错误，不是运行时状态。 */
export function defaultAcpAgent(): AcpAgentDescriptor {
  const [first] = AGENTS

  if (first === undefined) {
    throw new Error('no ACP agent is registered')
  }

  return first
}
