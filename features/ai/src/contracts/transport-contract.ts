import type { AgentId } from './agent-contract'

/**
 * 传输端口。
 *
 * Phase 4 会把实现换成 Tauri IPC（密钥不进 WebView），届时 UI 与 application 层零改动。
 */
export interface AssistantTransportPort {
  readonly endpoint: string
  readonly headers?: Readonly<Record<string, string>>
  readonly buildBody?: (agentId: AgentId) => Readonly<Record<string, unknown>>
}
