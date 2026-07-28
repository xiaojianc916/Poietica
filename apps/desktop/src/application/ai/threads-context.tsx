import type { ThreadsSelection } from '@poietica/agent-runtime'
import { useThreads } from '@poietica/agent-runtime'
import type { ReactNode } from 'react'
import { createContext, useContext, useMemo } from 'react'

import { desktopSessionConfig, desktopThreads } from './agent-session'

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
  /*
   * 会话设置也在这里。一条对话持有一个会话，选择器是那个会话说出来的，所以
   * 它和对话列表是同一份状态：侧栏、标签、输入框旁边的选择器读的都是它。
   */
  const config = useMemo(() => desktopSessionConfig(), [])
  const threads = useThreads(port, config)

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
  const config = useMemo(() => (shared === null ? desktopSessionConfig() : undefined), [shared])
  const own = useThreads(port, config)

  return shared ?? own
}
