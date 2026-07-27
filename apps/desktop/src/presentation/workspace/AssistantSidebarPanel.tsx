import type { AssistantThreadSummary } from '@poietica/features-ai/react'
import { AssistantThreadList } from '@poietica/features-ai/react'
import { useState } from 'react'

/*
 * 侧边栏下半部分的固定内容。
 *
 * 这里注入具体组件而不是一张按 surface 索引的渲染表：侧边栏的结构是固定的，
 * 表里只会有一个键，而一个键的 map 只会让"点别的导航项侧边栏就空掉"这种
 * 故障有地方藏。features/workspace 因此仍然不认识 features/ai。
 *
 * P2 replaces this fixture with the persisted thread store.
 */
const FIXTURE: readonly AssistantThreadSummary[] = [
  { id: 't1', title: '理解需求与脚本开发', relativeTime: '2 分钟', group: '今天' },
  { id: 't2', title: '严格专业代码审查要求', relativeTime: '1 小时', group: '今天' },
  { id: 't3', title: '开箱即用的 AI 组件', relativeTime: '1 小时', group: '今天' },
  { id: 't4', title: 'Poietica 架构总结', relativeTime: '1 小时', group: '今天' },
  { id: 't5', title: '全局报错 UI 重构需求', relativeTime: '13 小时', group: '昨天' },
  { id: 't6', title: '修改脚本和提交命令', relativeTime: '14 小时', group: '昨天' },
]

export function AssistantSidebarPanel() {
  const [activeThreadId, setActiveThreadId] = useState<string | null>('t1')

  return (
    <AssistantThreadList
      activeThreadId={activeThreadId}
      onActivate={setActiveThreadId}
      onCreate={() => {
        setActiveThreadId(null)
      }}
      onPin={() => {}}
      threads={FIXTURE}
    />
  )
}
