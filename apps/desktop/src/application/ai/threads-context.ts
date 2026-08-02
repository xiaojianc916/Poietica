import type { SessionConfigControl } from '@poietica/acp'
import type { ThreadsList, ThreadsStore } from '@poietica/agent-session'
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'

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
 *
 * 这个模块不导出组件，Provider 在 ThreadsProvider.tsx。那不是分层洁癖：
 * createContext() 在模块顶层执行，context 的身份就是这一次执行的产物，而
 * 一个同时导出组件与非组件的模块不满足 Fast Refresh 原地替换的条件，改动
 * 时只能被整模块重跑 —— 于是跑出一个新的 context，而尚未失效的消费者还握
 * 着旧的那个，界面当场抛下面那句话。拆开之后，改 Provider 走的是组件替换，
 * context 的身份不再随开发期的改动漂移。
 */

export const ThreadsContext = createContext<ThreadsStore | null>(null)

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

/*
 * 一格只订自己要的那一片。
 *
 * 这里此前是 useSharedThreads：它订阅整份 Held 快照，却把 useSyncExternalStore
 * 的返回值原地丢掉 —— 订了一切，一样都没读。而 #commit 每次提交都换一个 Held
 * 对象（{ ...this.#held, ...patch }，十一个调用点，其中 #remember 是 agent 主动
 * 上报的落点），于是「另一条对话认领到了选择器」这种与本格无关的事实，会让
 * ConversationSurface 连同它下面整棵助手树 —— 转录、虚拟列表、输入框 —— 重画。
 *
 * 切片天然是引用稳定的：selectors 那张表由 #with 维护，值没变就原样交回同一个
 * Map，useSyncExternalStore 自己就会跳过。与转录那一侧的 useSlice 同一个形状，
 * 不是第二套办法。
 */

/** 这条对话的选择器；还没拿到过是 undefined。 */
export function useThreadSelectors(
  threadId: string | null,
): readonly SessionConfigControl[] | undefined {
  const store = useStore()

  const read = useCallback(
    () => (threadId === null ? undefined : store.selectorsOf(threadId)),
    [store, threadId],
  )

  return useSyncExternalStore(store.subscribe, read, read)
}

/** 这条对话上一次认领或改动失败时的说法。 */
export function useThreadSelectorFailure(threadId: string | null): string | undefined {
  const store = useStore()

  const read = useCallback(
    () => (threadId === null ? undefined : store.selectorFailureOf(threadId)),
    [store, threadId],
  )

  return useSyncExternalStore(store.subscribe, read, read)
}
