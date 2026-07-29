import { AssistantThreadList } from '@poietica/agent-ui'
import { useCallback } from 'react'

import { useThreadsActions, useThreadsList } from '../../application/ai/threads-context'

/*
 * 侧栏的会话列表。
 *
 * 这里不再把记录二次加工成行：名字的三个来源在 store 里就已经分出胜负，
 * 列表项的引用也由 store 负责保持——值没变的行拿到的是同一个对象。加上
 * 下面这些回调各自钉住了标识，行组件的浅比较才第一次真的有东西可比。
 *
 * 此前这里每次渲染都 map 出一批新对象，五个回调全是内联箭头，于是行组件
 * 上的 memo 一次都没有命中过：时钟跳一下、上游任何一个 store 动一下，整张
 * 列表连同每一行各自持有的菜单根都要重建。
 */

export interface AssistantSidebarPanelProps {
  readonly activeThreadId: string | null
  readonly onCreate: () => void
  readonly onOpen: (threadId: string, title: string) => void
  readonly onOpenInNewTab: (threadId: string, title: string) => void
}

export function AssistantSidebarPanel({
  activeThreadId,
  onCreate,
  onOpen,
  onOpenInNewTab,
}: AssistantSidebarPanelProps) {
  const threads = useThreadsActions()
  const { isLoading, items } = useThreadsList()

  const activate = useCallback(
    (threadId: string) => {
      onOpen(threadId, threads.titleOf(threadId))
    },
    [onOpen, threads],
  )

  const openInNewTab = useCallback(
    (threadId: string) => {
      onOpenInNewTab(threadId, threads.titleOf(threadId))
    },
    [onOpenInNewTab, threads],
  )

  const pin = useCallback(
    (threadId: string, pinned: boolean) => {
      void threads.setPinned(threadId, pinned)
    },
    [threads],
  )

  const rename = useCallback(
    (threadId: string, title: string) => {
      void threads.rename(threadId, title)
    },
    [threads],
  )

  const remove = useCallback(
    (threadId: string) => {
      void threads.remove(threadId)
    },
    [threads],
  )

  return (
    <AssistantThreadList
      activeThreadId={activeThreadId}
      isLoading={isLoading}
      onActivate={activate}
      onCreate={onCreate}
      onDelete={remove}
      onOpenInNewTab={openInNewTab}
      onPin={pin}
      onRename={rename}
      threads={items}
    />
  )
}
