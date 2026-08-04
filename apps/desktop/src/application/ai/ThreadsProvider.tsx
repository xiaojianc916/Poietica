import { ThreadsStore, TranscriptStore, TranscriptsProvider } from '@poietica/agent-session'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { desktopSessionConfig, desktopThreads } from './agent-session'
import { ThreadsContext } from './threads-context'

/*
 * 这个模块只导出组件（类型导出在运行时不存在，不影响）。
 * 理由见 threads-context.ts 的顶部。
 */

export interface ThreadsProviderProps {
  readonly children: ReactNode
}

/** Holds the shared conversation state for everything below it. */
export function ThreadsProvider({ children }: ThreadsProviderProps) {
  /*
   * 会话设置也在这里。一条对话持有一个会话，选择器是那个会话说出来的，所以
   * 它和对话列表是同一份状态：侧栏、标签、输入框旁边的选择器读的都是它。
   */
  /*
   * 第三个参数是转录那一侧。
   *
   * 打开一条对话会把它的经过一起带回来 —— 那是 agent 在 session/load 期间重放
   * 的帧，也是这段历史唯一的来源。交接必须发生在打开它的地方，这里就是造出那
   * 个 store 的唯一一行。
   */
  /*
   * 转录归这一棵树，不归这个进程：造它的地方与造对话列表的是同一处 —— 现在真的
   * 是同一处，两者在一个初始化函数里成对建出来，memo 之间的链式依赖没了。
   *
   * 必须是 useState 的初始化函数而不是 useMemo：useMemo 只是性能优化，React 允许
   * 丢弃缓存重算，而 TranscriptStore 持有 session/load 期间重放的帧 —— 这段历史
   * 没有第二个来源，换一个实例就等于让用户手里的对话经过凭空消失。
   */
  const [{ store, transcripts }] = useState(() => {
    const transcriptStore = new TranscriptStore()

    return {
      store: new ThreadsStore(desktopThreads(), desktopSessionConfig(), transcriptStore),
      transcripts: transcriptStore,
    }
  })

  useEffect(() => {
    void store.refresh()

    /*
     * 模型清单曾在这里装上，用的是 defaultAcpAgent() —— 一个写死的 agent。它按
     * agent 分家，所以它的装载点是知道 agentId 的那一处（ConversationSurface），
     * 与 default_model 同一个 effect。
     */

    /*
     * 听 agent 自己报选择器。订阅与退订在同一个 effect 里成对出现，所以这
     * 个 Provider 装载几次就配平几次。
     */
    return store.start()
  }, [store])

  return (
    <TranscriptsProvider value={transcripts}>
      <ThreadsContext.Provider value={store}>{children}</ThreadsContext.Provider>
    </TranscriptsProvider>
  )
}
