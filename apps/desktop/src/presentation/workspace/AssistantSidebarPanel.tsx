import { useSharedThreads } from '@poietica/agent-runtime'
import type { AssistantThreadSummary } from '@poietica/agent-ui'
import { AssistantThreadList } from '@poietica/agent-ui'

/*
 * 侧边栏下半部分：真实的会话记录。
 *
 * 列表来自数据库；固定是事实，所以它落库，并把行提到「已固定」这一组。
 * 时间与分组在这里现算：它们是显示方式，不是需要落库的事实。
 *
 * 加号不在这里决定去哪：目的地是工作台的一格，由工作台自己去开或去激活，
 * 这一层只把点击原样交出去。
 */

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** Names when a conversation was last touched, and which day it belongs to. */
function describe(updatedAt: string, now: number) {
  const moment = Date.parse(updatedAt)

  if (Number.isNaN(moment)) {
    return { relativeTime: '', group: '更早' }
  }

  const since = Math.max(now - moment, 0)
  const days = Math.floor(since / DAY)
  const group = days === 0 ? '今天' : days === 1 ? '昨天' : '更早'

  if (since < MINUTE) {
    return { relativeTime: '刚刚', group }
  }

  if (since < HOUR) {
    return { relativeTime: `${Math.floor(since / MINUTE)} 分钟`, group }
  }

  if (since < DAY) {
    return { relativeTime: `${Math.floor(since / HOUR)} 小时`, group }
  }

  return { relativeTime: `${days} 天`, group }
}

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
  const now = Date.now()

  const summaries: readonly AssistantThreadSummary[] = threads.threads.map((thread) => {
    const when = describe(thread.updatedAt, now)
    const pinned = thread.pinned === true

    return {
      id: thread.threadId,
      title: threads.titleOf(thread.threadId),
      relativeTime: when.relativeTime,
      group: pinned ? '已固定' : when.group,
      isPinned: pinned,
    }
  })

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
