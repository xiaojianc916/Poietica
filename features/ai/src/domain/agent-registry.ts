import type { AgentDefinition, AgentId, AgentRegistryPort } from '../contracts/agent-contract'

export const DEFAULT_AGENT_ID: AgentId = 'super-computer'

export const DEFAULT_AGENT: AgentDefinition = Object.freeze({
  id: DEFAULT_AGENT_ID,
  name: 'Super Computer',
  description: '通用画布助手。',
  badge: 'New',
  systemPrompt: '你是 Poietica 的画布助手。',
  capabilities: Object.freeze(['canvas.read', 'workspace.search'] as const),
  tools: Object.freeze([]),
})

export function createAgentRegistry(
  initial: readonly AgentDefinition[] = [DEFAULT_AGENT],
): AgentRegistryPort {
  const agents = new Map<AgentId, AgentDefinition>(initial.map((agent) => [agent.id, agent]))

  return {
    list: () => [...agents.values()],
    get: (id) => agents.get(id),
    register: (agent) => {
      if (agents.has(agent.id)) {
        throw new Error(`[ai] duplicate agent id: ${agent.id}`)
      }
      agents.set(agent.id, agent)
    },
  }
}
