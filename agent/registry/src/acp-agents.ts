import type { AcpAgentDescriptor } from './acp-agent-contract'
import { kimiCode } from './agents/kimi'

export type {
  AcpAgentDescriptor,
  AcpQuestionDialect,
  AcpToolCallContentEntry,
  AcpToolCallContentRule,
} from './acp-agent-contract'

/*
 * 软件支持哪几家 ACP agent。
 *
 * 名单是封闭的：用户在这几家里选，不能自带一条命令。所以这里没有解析、没有
 * 校验、没有反注入 —— 那些是给「用户可以填任意命令」准备的，而这个入口不存在。
 *
 * 接第 N 家 = 新增一个 agents/<name>.ts，然后在这张表里加一行。通用层一个字
 * 都不用改；如果改了，就说明还没解耦干净。
 */
const AGENTS = [kimiCode] as const satisfies readonly AcpAgentDescriptor[]

/** 名单里的 id，由名单本身推出来，不另抄一份常量。 */
export type AcpAgentId = (typeof AGENTS)[number]['id']

export function acpAgents(): readonly AcpAgentDescriptor[] {
  return AGENTS
}

export function defaultAcpAgent(): AcpAgentDescriptor {
  const first = AGENTS[0]

  if (first === undefined) {
    throw new Error('no ACP agent is registered')
  }

  return first
}

/** 按 id 取档案。名单封闭，取不到不是常态，所以由调用方决定怎么处置。 */
export function acpAgentById(id: string): AcpAgentDescriptor | undefined {
  return AGENTS.find((agent) => agent.id === id)
}
