import type { ThreadsSelection } from '@poietica/features-ai/application'
import { useThreads } from '@poietica/features-ai/application'
import type { ReactNode } from 'react'
import { createContext, useContext, useMemo } from 'react'

import { desktopThreads } from './agent-session'

/*
 * One conversation state, shared by the sidebar and the tab strip.
 *
 * Both show the same thing from different places, so they must read the
 * same state: two copies would let the list highlight one conversation
 * while the tabs believe another is open.
 */

const ThreadsContext = createContext<ThreadsSelection | null>(null)

export interface ThreadsProviderProps {
  readonly children: ReactNode
}

/** Holds the shared conversation state for everything below it. */
export function ThreadsProvider({ children }: ThreadsProviderProps) {
  const port = useMemo(() => desktopThreads(), [])
  const threads = useThreads(port)

  return <ThreadsContext.Provider value={threads}>{children}</ThreadsContext.Provider>
}

/**
 * Reads the shared conversation state.
 *
 * Without a provider above it a component falls back to a copy of its own,
 * so a panel still works in isolation. Both hooks are called every render,
 * because which one answers is not allowed to change the order of hooks.
 */
export function useSharedThreads(): ThreadsSelection {
  const shared = useContext(ThreadsContext)
  const port = useMemo(() => (shared === null ? desktopThreads() : undefined), [shared])
  const own = useThreads(port)

  return shared ?? own
}
