import type { AgentSessionPort } from '@poietica/agent-protocol'
import { defaultAcpAgent } from '@poietica/agent-registry'
import type { AgentDialect } from '@poietica/agent-ui'
import { AgentDialectProvider } from '@poietica/agent-ui'
import type { WorkspaceSurfaceRenderers } from '@poietica/features-workspace/contracts'

import { AssistantPane } from './AssistantPane'

/**
 * 组合根：把 AI feature 接入 workspace 表面扩展点。
 *
 * features/workspace 只声明插槽，features/ai 只声明端口，两者互不认识；
 * 会话端口在这里注入，因此这是唯一知道两者存在的地方。
 *
 * 「这一格变成了一条对话」同样是两边的交界事实，所以也从这里传进去。
 *
 * 对面那家 agent 的方言也在这里交出去。会话本来就是拿这份档案建起来的
 * （见 application/ai/agent-session.ts），所以「跟谁说话」和「它怎么说话」
 * 出自同一个答案，不会各说各的。界面包不认识名单，名单只在这一行露面。
 */

/** 档案里跟界面有关的那几格，摘成界面认得的形状。 */
function dialectOf(agent: ReturnType<typeof defaultAcpAgent>): AgentDialect {
  return {
    optionLabels: agent.optionLabels,
    questions: agent.questionDialect === undefined ? [] : [agent.questionDialect],
  }
}

/* 一个进程一份：每次渲染新建一个对象会让整棵子树的记忆化失效。 */
const DIALECT = dialectOf(defaultAcpAgent())

export function createAssistantSurfaceRenderers(
  session: AgentSessionPort,
  onConversationStarted: (threadId: string, title: string) => void,
): WorkspaceSurfaceRenderers {
  return {
    ai: () => (
      <AgentDialectProvider dialect={DIALECT}>
        <AssistantPane onConversationStarted={onConversationStarted} session={session} />
      </AgentDialectProvider>
    ),
  }
}
