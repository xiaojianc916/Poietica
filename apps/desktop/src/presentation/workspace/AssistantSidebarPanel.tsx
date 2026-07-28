import type { AssistantThreadSummary } from '@poietica/agent-ui'
import { AssistantThreadList } from '@poietica/agent-ui'
import { useSharedThreads } from '../../application/ai/threads-context'

/*
 * 侧边栏下半部分：真实的会话记录。
 *
 * 列表来自数据库；固定是事实，所以它落库，列表据此把行提到「已固定」那一段。
 * 时间文案与日期分段不在这里算：它们随墙上时间变化，由列表自己的时钟驱动，
 * 这一层只把最后活动时刻原样交出去。此前这里在渲染函数体里读 Date.now()，
 * 于是标签只在别处状态碰巧变化时才跳一下，与真实时间无关。
 *
 * 加号不在这里决定去哪：目的地是工作台的一格，由工作台自己去开或去激活，
 * 这一层只把点击原样交出去。
 */

export interface AssistantSidebarPanelProps {
  readonly activeThreadId: string | null
  readonly onCreate: () => void
  readonly onOpen: (threadId: string, title: string) => void
  readonly onOpenInNewTab: (threadId: string, title: string) => void
}

/* 列表是导航：点一行替换正在看的那一格，「在新标签页打开」才追加一格。 */
export function AssistantSidebarPanel({
  activeThreadId,
  onCreate,
  onOpen,
  onOpenInNewTab,
}: AssistantSidebarPanelProps) {
  const threads = useSharedThreads()

  const summaries: readonly AssistantThreadSummary[] = threads.threads.map((thread) => ({
    id: thread.threadId,
    isPinned: thread.pinned === true,
    title: threads.titleOf(thread.threadId),
    updatedAt: thread.updatedAt,
  }))

  return (
    <AssistantThreadList
      activeThreadId={activeThreadId}
      isLoading={threads.isLoading}
      onActivate={(threadId) => {
        onOpen(threadId, threads.titleOf(threadId))
      }}
      onCreate={onCreate}
      onDelete={(threadId) => {
        void threads.remove(threadId)
      }}
      onOpenInNewTab={(threadId) => {
        onOpenInNewTab(threadId, threads.titleOf(threadId))
      }}
      onPin={(threadId, pinned) => {
        void threads.setPinned(threadId, pinned)
      }}
      onRename={(threadId, title) => {
        void threads.rename(threadId, title)
      }}
      threads={summaries}
    />
  )
}
