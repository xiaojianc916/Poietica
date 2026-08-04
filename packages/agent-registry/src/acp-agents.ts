import type { AcpAgentDescriptor } from './acp-agent-contract'
import { kimiCode } from './agents/kimi/descriptor'

export type { AcpAgentDescriptor, AcpQuestionDialect } from './acp-agent-contract'

/*
 * 软件支持哪几家 ACP agent。
 *
 * 名单是封闭的：用户在这几家里选，不能自带一条命令。所以这里没有解析、没有
 * 校验、没有反注入 —— 那些是给「用户可以填任意命令」准备的，而这个入口不存在。
 *
 * 接第 N 家 = 新增一个 agents/<id>/descriptor.ts，然后在这张表里加一行。通用层一个字
 * 都不用改；如果改了，就说明还没解耦干净。
 *
 * 类型是非空元组，不是数组：「一家都没有」在编译期就不成立，所以这里没有一句
 * 运行期的「no ACP agent is registered」要写。此前那句 throw 防的是一个类型
 * 本来就该排除的状态。
 *
 * 这里也不再由名单推出一个字面量 id 类型。那种类型今天恒等于 'kimi'，而它的
 * 运行期同伴 acpAgentById 收的是 string —— 编译期认为世界上只有一家、运行期
 * 认为可以有任意家，两套判据不一致。地址就是 string，唯一判据是查表。
 *
 * 也不再有 defaultAcpAgent：「默认哪一家」是用户在这台机器上的选择，产地是
 * 档案集的 defaultProfileId（见 acp-agent-profile.ts），不是名单的顺序。
 */
const AGENTS = [kimiCode] as const satisfies readonly [AcpAgentDescriptor, ...AcpAgentDescriptor[]]

export function acpAgents(): readonly [AcpAgentDescriptor, ...AcpAgentDescriptor[]] {
  return AGENTS
}

/** 按 id 取档案。名单封闭，取不到不是常态，所以由调用方决定怎么处置。 */
export function acpAgentById(id: string): AcpAgentDescriptor | undefined {
  return AGENTS.find((agent) => agent.id === id)
}
