/*
 * 这个包的唯一出口。
 *
 * 包内按 agentId 分文件，不按「契约 / 名单」分。这个形状是怎么来的，
 * 见 docs/architecture/README.md 的「包边界的由来」。
 */

export type { AcpAgentInstall, AcpQuestionDialect } from './acp-agent-contract'
export type {
  AcpAgentLaunch,
  AcpAgentProfile,
  AcpAgentProfileParse,
  AcpAgentProfileReconcile,
  AcpAgentProfileSet,
  AcpAgentProfileSetParse,
  AgentConfigOptionValue,
} from './acp-agent-profile'
export {
  acpAgentLaunch,
  builtinAcpAgentProfileSet,
  builtinAcpAgentProfiles,
  parseAcpAgentProfile,
  parseAcpAgentProfileSet,
  reconcileAcpAgentProfiles,
} from './acp-agent-profile'
export type { AcpAgentDescriptor } from './acp-agents'
export { acpAgentById, acpAgents } from './acp-agents'
export { agentCatalogCodec } from './catalog-codec'
export type { AgentCatalogAddRequest, AgentCatalogCodec } from './catalog-contract'
export { agentBareModelId, agentModelDisplayName } from './model-display'
export type {
  AgentProviderPreset,
  AgentProviderPresetModel,
  AgentProviderPresetModelThinking,
} from './provider-presets'
export { builtinAgentProviderById, builtinAgentProviders } from './provider-presets'
export type {
  AgentCredentialKind,
  AgentModelState,
  AgentProviderSnapshot,
  AgentProviderState,
} from './provider-state'
export { parseAgentProviderList, parseAgentProviderListOutput } from './provider-state'

/*
 * 这里曾导出 model-catalog 与 model-provider-profile 两组符号。两个模块都删了。
 *
 * model-provider-profile 描述的是「启动 agent 时把 base URL、密钥、默认模型注入
 * 环境变量」—— 模式 A。kimi-code 的 providers.md 写明它取凭据时不回落 shell 环境
 * 变量，那条路本来就不通；它还把 provider 方言枚举成两种、把模型 id 硬编码，而
 * 上游的 ProviderTypeSchema 是 z.string()，刻意不在解析期枚举 vendor 身份。
 *
 * model-catalog 自己去拉 models.dev，而 agent 内部也拉同一份，写入又必须经它的
 * CLI 校验。两份可能不同步的副本里只有一份说得上话。候选模型改问 agent 的
 * provider catalog list。
 */
