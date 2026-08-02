import { AssistantThreadList } from '@poietica/agent-ui'
import { memo, useCallback } from 'react'

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

/*
 * 记住不重建。
 *
 * 上面那段注释说的是为什么行组件能比：store 保持列表项引用，下面五个回调各自
 * 钉住标识。但那道护城河到这一层为止都没有城门 —— WorkspaceContainer 订的是
 * 整份工作台快照，切一次标签、关一次标签、拖动一次标签都让它重渲，而侧栏是它
 * JSX 里的一个裸组件。于是整张列表连同每一行的元素对象重建一遍，memo(ThreadRow)
 * 的浅比较照跑 N 次，每次都返回「相等」—— 代价全付，收益一点不取。
 *
 * 这一层的入参只有一个会真的变：activeThreadId。它变的时候列表本来就该重画
 * 高亮，其余时候这里应当一动不动。
 */
export const AssistantSidebarPanel = memo(function AssistantSidebarPanel({
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
})
