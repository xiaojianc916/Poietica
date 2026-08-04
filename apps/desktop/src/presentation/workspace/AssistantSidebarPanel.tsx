import { AssistantThreadList } from '@poietica/agent-ui'
import { memo, useCallback } from 'react'

import { useThreadsActions, useThreadsList } from '../../application/ai/threads-context'
import { toggleWorkspace, useCollapsedWorkspaces } from '../../application/ai/workspace-collapse'

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
 *
 * 分组同理不在这里算：它由 useThreadsList 一次性派生好，引用随数据走。
 *
 * onCreate 原样往下传，不按工作区分岔。加号点在哪个组头上，开出来的对话都
 * 落在当前那个工作目录里 —— 因为运行期只有一个（桌面侧建对话桥不传 cwd）。
 * 等原生侧真的逐条记下目录，这里才有第二个答案可给；在那之前多接一层只会
 * 让界面承诺一件它做不到的事。
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
 *
 * 「收起了哪些工作区」这份偏好在这里读。它有存储键、要跨窗口一致、一个进程只该
 * 有一份 —— 都是宿主的事实（application/ai/workspace-collapse），不是列表组件的
 * 内部记忆。往下只交出一个集合和一个动作，而 toggleWorkspace 是模块函数，引用
 * 天生稳定，memo 这道门不会因为多接一根线而失效。
 */
export const AssistantSidebarPanel = memo(function AssistantSidebarPanel({
  activeThreadId,
  onCreate,
  onOpen,
  onOpenInNewTab,
}: AssistantSidebarPanelProps) {
  const threads = useThreadsActions()
  const { groups, isLoading } = useThreadsList()
  const collapsedWorkspaces = useCollapsedWorkspaces()

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
      collapsedWorkspaces={collapsedWorkspaces}
      groups={groups}
      isLoading={isLoading}
      onActivate={activate}
      onCreate={onCreate}
      onDelete={remove}
      onOpenInNewTab={openInNewTab}
      onPin={pin}
      onRename={rename}
      onToggleWorkspace={toggleWorkspace}
    />
  )
})
