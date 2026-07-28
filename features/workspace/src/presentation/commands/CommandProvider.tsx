'use client'

import {
  type CommandRegistry,
  createCommandRegistry,
} from '@poietica/features-workspace/application'
import type { RegisteredCommand } from '@poietica/features-workspace/contracts'
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'

interface CommandContextValue {
  readonly commands: readonly RegisteredCommand[]
  readonly registry: CommandRegistry
}

const CommandContext = createContext<CommandContextValue | null>(null)

export interface CommandProviderProps {
  readonly children: ReactNode
  readonly registry?: CommandRegistry
}

export function CommandProvider({ children, registry: providedRegistry }: CommandProviderProps) {
  const [ownedRegistry] = useState(createCommandRegistry)
  const registry = providedRegistry ?? ownedRegistry
  const commands = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  )
  const value = useMemo(() => ({ commands, registry }), [commands, registry])

  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>
}

export function useCommands(): CommandContextValue {
  const context = useContext(CommandContext)
  if (!context) {
    throw new Error('useCommands must be used within a CommandProvider')
  }
  return context
}
