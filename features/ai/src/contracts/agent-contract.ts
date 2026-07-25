export type AgentId = string

/**
 * Agent 能力声明。
 *
 * 能力是显式的、可审计的；运行时据此裁剪工具集与权限，不允许隐式提权。
 */
export type AgentCapability =
  | 'canvas.read'
  | 'canvas.write'
  | 'workspace.search'
  | 'file.read'
  | 'network.fetch'

export interface AgentToolDescriptor {
  readonly name: string
  readonly description: string
  /** JSON Schema。工具入参必须可校验，禁止任意对象穿透。 */
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly requires: readonly AgentCapability[]
}

export interface AgentDefinition {
  readonly id: AgentId
  readonly name: string
  readonly description: string
  readonly badge?: string
  readonly systemPrompt: string
  readonly capabilities: readonly AgentCapability[]
  readonly tools: readonly AgentToolDescriptor[]
}

export interface AgentRegistryPort {
  readonly list: () => readonly AgentDefinition[]
  readonly get: (id: AgentId) => AgentDefinition | undefined
  readonly register: (agent: AgentDefinition) => void
}
