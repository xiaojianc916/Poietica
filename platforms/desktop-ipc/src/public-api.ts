export type {
  AgentCapabilityBridge,
  AgentOpenedThreadDescription,
  AgentThreadBridge,
  AgentThreadDescription,
} from './agent'
export {
  AGENT_EVENT,
  AGENT_SELECTOR_EVENT,
  type AgentBridgeOptions,
  type AgentConfigChoiceDescription,
  type AgentConfigControlDescription,
  type AgentConfigPurposeName,
  type AgentEventSource,
  type AgentEventSourceOptions,
  type AgentSelectorReport,
  /*
   * 会话的设置，和 agent 的配置，是两件事。
   *
   * 此前两者都叫 AgentConfigBridge / createAgentConfigBridge，还都从这里
   * 导出：一个名字指向两个毫无关系的实现，谁赢由打包顺序决定。桌面那侧把
   * 它当 SessionConfigPort 用，赢的若是下面那个，拿回来的对象根本没有
   * select。名字分开，问题就不存在了。
   */
  type AgentSessionConfigBridge,
  createAgentCapabilityBridge,
  createAgentCommandBridge,
  createAgentEventSource,
  createAgentSessionConfigBridge,
  createAgentThreadBridge,
  shutdownAgent,
} from './agent'
export {
  type AgentCliRequest,
  type AgentCliResult,
  type AgentConfigBridge,
  type AgentConfigSnapshot,
  createAgentConfigBridge,
} from './agent-config'
export {
  type IpcError,
  IpcInvocationError,
  isIpcError,
} from './error'
export { commands } from './generated/ipc-bindings'
export { invoke } from './invoke'
