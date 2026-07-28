import type { AgentSessionPort } from '@poietica/agent-protocol'

/**
 * The single extension point for adding an agent.
 *
 * A provider is data plus a factory, so the runtime, the timeline and the UI
 * never learn which agents exist: a new one is a registration, not an edit to
 * a switch statement somewhere downstream.
 */
export interface AgentProvider {
  readonly id: string
  readonly displayName: string
  readonly capabilities: Readonly<Record<string, boolean>>
  readonly connect: () => AgentSessionPort | Promise<AgentSessionPort>
}

export interface AgentRegistry {
  readonly register: (provider: AgentProvider) => void
  readonly get: (id: string) => AgentProvider | undefined
  readonly list: () => readonly AgentProvider[]
}

export function createAgentRegistry(initial: readonly AgentProvider[] = []): AgentRegistry {
  const providers = new Map<string, AgentProvider>()

  const register = (provider: AgentProvider): void => {
    if (providers.has(provider.id)) {
      throw new Error(`agent provider already registered: ${provider.id}`)
    }
    providers.set(provider.id, provider)
  }

  for (const provider of initial) {
    register(provider)
  }

  return {
    register,
    get: (id) => providers.get(id),
    list: () => [...providers.values()],
  }
}
