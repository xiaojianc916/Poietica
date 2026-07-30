import type { ThreadsList } from '@poietica/agent-runtime'
import { ThreadsStore } from '@poietica/agent-runtime'
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'

import {
  desktopSessionConfig,
  desktopThreads,
  installDesktopAgentCapabilities,
} from './agent-session'

/*
 * One conversation state, shared by the sidebar and the tab strip.
 *
 * Both show the same thing from different places, so they must read the
 * same state: two copies would let the list highlight one conversation
 * while the tabs believe another is open.
 *
 * Context 里放的是 store 本身，引用终生不变。此前放的是一个每次渲染都新建
 * 的选择对象，于是任何一处状态变动都会让每一个消费者连同它下面整棵树重画
 * ——包括正在流式输出的那条对话。谁重画由订阅决定，不由 Provider 决定。
 */

const ThreadsContext = createContext<ThreadsStore | null>(null)

export interface ThreadsProviderProps {
  readonly children: ReactNode
}

/** Holds the shared conversation state for everything below it. */
export function ThreadsProvider({ children }: ThreadsProviderProps) {
  /*
   * 会话设置也在这里。一条对话持有一个会话，选择器是那个会话说出来的，所以
   * 它和对话列表是同一份状态：侧栏、标签、输入框旁边的选择器读的都是它。
   */
  const store = useMemo(() => new ThreadsStore(desktopThreads(), desktopSessionConfig()), [])

  useEffect(() => {
    void store.refresh()

    /*
     * 能力表属于 agent 进程，不属于任何一条对话：入口那一格靠它才有东西可画。
     * 这里只是把端口交出去，不起进程。
     */
    installDesktopAgentCapabilities()
  }, [store])

  return <ThreadsContext.Provider value={store}>{children}</ThreadsContext.Provider>
}

/*
 * 没有 Provider 就是接线错了，而不是退化成自带一份：两份状态会各自读一遍列表，
 * 并且能各自认为不同的对话正被打开——侧栏亮着一条、标签停在另一条就是这么来的。
 */
function useStore(): ThreadsStore {
  const shared = useContext(ThreadsContext)

  if (shared === null) {
    throw new Error('会话状态需要上层的 ThreadsProvider')
  }

  return shared
}

/** 只要动作，不订阅：拿到的回调引用终生不变，可以直接传给行组件。 */
export function useThreadsActions(): ThreadsStore {
  return useStore()
}

/** 侧栏读的那一片：这三样之外的变化不会惊动它。 */
export function useThreadsList(): ThreadsList {
  const store = useStore()

  return useSyncExternalStore(store.subscribe, store.listSnapshot, store.listSnapshot)
}

/** 订阅整份会话状态。对话那一格读的是按 id 取的零散事实，仍走这里。 */
export function useSharedThreads(): ThreadsStore {
  const store = useStore()

  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  return store
}
