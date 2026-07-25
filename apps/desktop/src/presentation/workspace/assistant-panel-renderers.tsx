import { AssistantThreadList } from '@poietica/ai/react'
import type { AssistantThreadSummary } from '@poietica/ai/react'
import type { WorkspacePanelRenderers } from '@poietica/workspace/contracts'
import { useState } from 'react'

/*
 * P2 replaces this fixture with the persisted thread store. The panel is
 * injected here so features/workspace never imports features/ai.
 */
const FIXTURE: readonly AssistantThreadSummary[] = [
  { id: 't1', title: '理解需求与脚本开发', relativeTime: '2 分钟', group: '今天' },
  { id: 't2', title: '严格专业代码审查要求', relativeTime: '1 小时', group: '今天' },
  { id: 't3', title: '开箱即用的 AI 组件', relativeTime: '1 小时', group: '今天' },
  { id: 't4', title: 'Poietica 架构总结', relativeTime: '1 小时', group: '今天' },
  { id: 't5', title: '全局报错 UI 重构需求', relativeTime: '13 小时', group: '昨天' },
  { id: 't6', title: '修改脚本和提交命令', relativeTime: '14 小时', group: '昨天' },
]

function AssistantPanel() {
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

export const WORKSPACE_PANEL_RENDERERS: WorkspacePanelRenderers = {
  ai: () => <AssistantPanel />,
}
