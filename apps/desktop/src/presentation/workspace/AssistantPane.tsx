import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import { DEFAULT_THREAD_ID } from '../../application/ai/agent-session'
import { ConversationSurface } from './ConversationSurface'

/*
 * AI 表面：还没有指向任何一条已有对话的那一格。
 *
 * 标签不再由这里自造 —— 已有对话由工作台开成一等标签，所以这里只剩下
 * 「新对话」这一种形态。
 */

export interface AssistantPaneProps {
  readonly session: AgentSessionPort
}

export function AssistantPane({ session }: AssistantPaneProps) {
  return <ConversationSurface session={session} threadId={DEFAULT_THREAD_ID} />
}

function RetiredAssistantPane({ session }: AssistantPaneProps) {
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
