import type { AssistantThreadSummary } from '@poietica/features-ai/react'
import { AssistantThreadList } from '@poietica/features-ai/react'

import { useSharedThreads } from '../../application/ai/threads-context'

/*
 * 侧边栏下半部分：真实的会话记录。
 *
 * 列表来自数据库，标题的来源由 useThreads 决定：官方标题优先，其次是
 * 用户第一句话的临时标题，都没有时显示 AI。加号真的开一个会话，因此
 * 列表里的每一行都对应 agent 认得的 session。
 *
 * 时间与分组在这里现算：它们是显示方式，不是需要落库的事实。
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
  readonly onOpen: (threadId: string, title: string) => void
  readonly onOpenInNewTab: (threadId: string, title: string) => void
}

/* 列表是导航：点一行替换正在看的那一格，「在新标签页打开」才追加一格。 */
export function AssistantSidebarPanel({
  activeThreadId,
  onOpen,
  onOpenInNewTab,
}: AssistantSidebarPanelProps) {
  const threads = useSharedThreads()
  const now = Date.now()

  const summaries: readonly AssistantThreadSummary[] = threads.threads.map((thread) => {
    const when = describe(thread.updatedAt, now)

    const pinned = thread.pinned === true

    /* 固定过的会话自成一组，排在最前：这是它们被固定的意思。 */
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
        threads.activate(threadId)
        onOpen(threadId, threads.titleOf(threadId))
      }}
      onCreate={() => {
        void threads.create()
      }}
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
