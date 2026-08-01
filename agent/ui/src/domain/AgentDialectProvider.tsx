import type { ReactNode } from 'react'
import { type AgentDialect, AgentDialectContext } from './agent-dialect'

/* 只导出组件。理由见 agent-dialect.ts 的顶部。 */

export interface AgentDialectProviderProps {
  readonly dialect: AgentDialect
  readonly children: ReactNode
}

export function AgentDialectProvider({ children, dialect }: AgentDialectProviderProps) {
  return <AgentDialectContext.Provider value={dialect}>{children}</AgentDialectContext.Provider>
}
