export type { AgentCommandBridge, AgentEventSource, IpcSessionOptions } from './acp-session'
export { createIpcSession } from './acp-session'
export {
  AGENT_EVENT,
  AGENT_SELECTOR_EVENT,
  type AgentBridgeOptions,
  type AgentEventSourceOptions,
  type AgentLaunchDescription,
  createAgentCapabilityBridge,
  createAgentCommandBridge,
  createAgentEventSource,
  /*
   * 会话的设置，和 agent 的配置，是两件事。
   *
   * 此前两者都叫 AgentConfigBridge / createAgentConfigBridge，还都从这里
   * 导出：一个名字指向两个毫无关系的实现，谁赢由打包顺序决定。桌面那侧把
   * 它当 SessionConfigPort 用，赢的若是下面那个，拿回来的对象根本没有
   * select。名字分开，问题就不存在了 —— 上面这一个今天连返回类型都直接是
   * SessionConfigPort，两者再也长不成一个样子。
   */
  createAgentSessionConfigBridge,
  createAgentThreadBridge,
  shutdownAgent,
} from './agent'
export {
  type AgentCliRequest,
  type AgentCliResult,
  type AgentConfigBridge,
  type AgentConfigSnapshot,
  type AgentInstallStatus,
  createAgentConfigBridge,
} from './agent-config'
export {
  type AssetFormat,
  type AssetImport,
  closeAssetSession,
  importAssets,
  listAssetFormats,
  openAssetSession,
  removeAsset,
  uploadAsset,
} from './asset'
export {
  type Automation,
  type AutomationCatalog,
  type AutomationReschedule,
  type AutomationRun,
  type AutomationRunOutcome,
  type AutomationRunRecord,
  loadAutomations,
  recordAutomationRun,
  removeAutomation,
  upsertAutomation,
  watchAutomations,
} from './automations'
export { type EnvironmentFile, readEnvironmentMcpConfig } from './environment'
export {
  type IpcError,
  IpcInvocationError,
  isIpcError,
  throughIpc,
} from './error'
export { type McpEndpoint, readMcpEndpoint } from './mcp'
export {
  commitPlugin,
  discardStagedPlugin,
  listPlugins,
  type PluginCommitRequest,
  type PluginFetch,
  type PluginFileRequest,
  type PluginPayload,
  type PluginStaged,
  readPluginCatalog,
  readPluginText,
  refreshPluginCatalog,
  removePlugin,
  setPluginEnabled,
  setPluginMcpEnabled,
  stagePlugin,
} from './plugins'
export { pickWorkspaceRoot } from './workspace'
