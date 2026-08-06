import type { AgentSessionPort } from '@poietica/acp'
import { AutomationsSurface } from '@poietica/automations'
import type { AgentConfigStore } from '@poietica/settings'
import type { WorkspaceSurfaceRenderers } from '@poietica/workspace'
import type { ReactNode } from 'react'
import { currentAgentId } from '../assistant/agent-session'
import { automationStore } from '../automations/automation-runtime'
import { AssistantPane } from './assistant-pane'
import { ConversationSurface } from './conversation-surface'

/**
 * AI 接入工作区的全部接线。
 *
 * packages/workspace 只认识插槽和 surface 种类,agent 那边只认识会话端口,
 * 两者互不认识;会话端口在这里、且只在这里交出去。
 *
 * 为什么是「全部」而不只是表面插槽:助手界面有两个入口 —— AI 那一格
 * (AssistantPane),以及一条对话被提升成标签页之后的 ConversationSurface。
 * 两者要的是同一对依赖。此前后者就地写在 WorkspaceContainer 里,于是给助手
 * 树补 provider 时只补到了前者,应用在发出第一条消息时崩掉。依赖只从一个
 * 口子出去,再多一个入口也必须落在这个文件,漏不掉。
 *
 * 「这一格变成了一条对话」是两边的交界事实,所以也从这里传进去。
 *
 * 对面那家 agent 的方言不在这里:它是一个进程一份的事实,和会话列表同级,
 * 落在 presentation/AppShell.tsx。
 */
export interface AssistantWiring {
  /** 工作区表面插槽:AI 那一格。 */
  readonly surfaces: WorkspaceSurfaceRenderers
  /** 一条对话占住整个标签页时的样子。 */
  readonly renderConversation: (threadId: string) => ReactNode
}

/*
 * 写给哪一家 agent，和起哪一家 agent，现在真的是同一个答案。
 *
 * 两边都读 currentAgentId()（application/ai/agent-session.ts），所以选择器要写的
 * default_model 与会话 spawn 的那一家不可能对不上。此前这里是一个模块常量，取的
 * 是注册表第一行，而用户选的那一家写在 agents.json 里 —— 名单长到两家的那天，
 * "改完了但会话没变"就会成真。
 *
 * 每次渲染现取。常量换来的是引用稳定，而换 agent 时那恰好是错的。
 */

export function createAssistantWiring(
  session: AgentSessionPort,
  agentConfig: AgentConfigStore,
  onConversationStarted: (threadId: string, title: string) => void,
): AssistantWiring {
  return {
    surfaces: {
      ai: () => (
        <AssistantPane
          agentConfig={agentConfig}
          agentId={currentAgentId()}
          onConversationStarted={onConversationStarted}
          session={session}
        />
      ),

      /*
       * 自动化那一格。渲染器现在是全域 Record（见 @poietica/workspace 的
       * surface.ts）：注册表里登记了 automations，这里就必须交出一条，
       * 漏掉是编译错误而不是一张空态图。
       */
      automations: () => <AutomationsSurface store={automationStore} />,
    },

    renderConversation: (threadId) => (
      <ConversationSurface
        agentConfig={agentConfig}
        agentId={currentAgentId()}
        onStarted={onConversationStarted}
        session={session}
        threadId={threadId}
      />
    ),
  }
}
