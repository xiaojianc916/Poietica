import './assistant-tabs.css'

import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import { AssistantSurface } from '@poietica/features-ai/react'

import {
  DEFAULT_THREAD_ID,
  desktopAgentModels,
  desktopSessionConfig,
} from '../../application/ai/agent-session'
import { useSharedThreads } from '../../application/ai/threads-context'

/*
 * 多标签页的 AI 界面。
 *
 * 标签条放在 surface 外面：一条对话的显示方式属于容器，surface 自己只
 * 负责一条对话。没有打开任何标签时不画标签条，而不是画一条空的。
 */

export interface AssistantPaneProps {
  readonly session: AgentSessionPort
}

export function AssistantPane({ session }: AssistantPaneProps) {
  const threads = useSharedThreads()

  return (
    <div className="assistant-pane">
      {threads.tabs.length === 0 ? null : (
        <div className="assistant-tabs" data-assistant-skin role="tablist">
          {threads.tabs.map((tab) => (
            <div
              className="assistant-tabs__tab"
              data-active={tab.threadId === threads.activeThreadId ? 'true' : undefined}
              key={tab.threadId}
            >
              <button
                aria-selected={tab.threadId === threads.activeThreadId}
                className="assistant-tabs__open"
                onClick={() => {
                  threads.activate(tab.threadId)
                }}
                role="tab"
                type="button"
              >
                {tab.title}
              </button>

              <button
                aria-label="关闭标签页"
                className="assistant-tabs__close"
                onClick={() => {
                  threads.closeTab(tab.threadId)
                }}
                type="button"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <AssistantSurface
        config={desktopSessionConfig()}
        endpoint={threads.activeThreadId ?? DEFAULT_THREAD_ID}
        models={desktopAgentModels()}
        session={session}
      />
    </div>
  )
}
