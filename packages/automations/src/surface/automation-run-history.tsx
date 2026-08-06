import type { Automation } from '@poietica/ipc'

import { describeMoment } from '../automation'

/**
 * 这条自动化跑过的那些次。
 *
 * 账本只留最近 RUN_HISTORY_LIMIT 条，再往前的正文仍在各自那条对话里 —— 这一层
 * 不复述运行内容，会话才是唯一中心。
 *
 * 还不能点进那次对话：openConversation 在工作台的命令面上，而 createAssistantWiring
 * 今天只拿到 session / agentConfig / onConversationStarted 三样。为了一块界面去
 * 拓宽组合根的签名，顺序是反的 —— 那一步单独做。
 */

export interface AutomationRunHistoryProps {
  readonly runs: Automation['runs']
}

export function AutomationRunHistory({ runs }: AutomationRunHistoryProps) {
  if (runs.length === 0) {
    return <p className="py-10 text-center text-xs text-muted-foreground">还没有运行过。</p>
  }

  return (
    <ul className="mt-6 divide-y divide-divider/60 rounded-lg border border-divider bg-background">
      {runs.map((run) => (
        <li
          className="flex items-center justify-between px-4 py-2.5 text-xs"
          key={run.startedAt + (run.threadId ?? '')}
        >
          <span className={run.outcome === 'succeeded' ? '' : 'text-destructive'}>
            {run.outcome === 'succeeded' ? '成功' : '失败'}
          </span>

          <span className="text-muted-foreground">
            {run.threadId === null ? '没有留下对话' : '留下了一条对话'}
          </span>

          <span className="tabular-nums text-muted-foreground">
            {describeMoment(run.startedAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}
