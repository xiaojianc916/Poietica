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
