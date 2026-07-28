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
 * 没有 Provider 就是接线错了，而不是退化成自带一份：两份状态会各自读一遍列表，
 * 并且能各自认为不同的对话正被打开——侧栏亮着一条、标签停在另一条就是这么来的。
 */
export function useSharedThreads(): ThreadsSelection {
  const shared = useContext(ThreadsContext)

  if (shared === null) {
    throw new Error('useSharedThreads 需要上层的 ThreadsProvider')
  }

  return shared
}
