import type { AgentSessionPort } from '@poietica/features-ai/contracts'
import { AssistantSurface } from '@poietica/features-ai/react'

import { desktopSessionConfig } from '../../application/ai/agent-session'
import { useSharedThreads } from '../../application/ai/threads-context'

/*
 * 一格只画一条对话。
 *
 * 标签的身份由工作台保管（conversation:<threadId>），所以这里没有自己的标签条。
 *
 * 名字是这里唯一额外接的一根线：兜底标题就是“我”说的第一句，那句话一发出，
 * 列表立刻改名并补上这一行（原生侧同一次 agent_prompt 也会把它写成 message
 * 来源的标题），随后刷新把官方标题接回来——官方标题永远压过临时的那个。
 *
 * 对话的 id 随那句话一起送来，不从这里的闭包里取：入口那一格在说话的那一刻
 * 才知道自己是哪条对话，闭包里的还是说话之前的答案，也就是没有答案。
 */

export interface ConversationSurfaceProps {
  /** 取得这一格即将成为的那条对话。只有入口那一格需要它。 */
  readonly onIdentify?: (() => Promise<string | null>) | undefined
  /** 这条对话说出第一句话时，带上它当时的名字。 */
  readonly onStarted?: (threadId: string, title: string) => void
  readonly session: AgentSessionPort
  readonly threadId: string | null
}

export function ConversationSurface({
  onIdentify,
  onStarted,
  session,
  threadId,
}: ConversationSurfaceProps) {
  const threads = useSharedThreads()

  return (
    <AssistantSurface
      config={desktopSessionConfig()}
      endpoint={threadId}
      identify={onIdentify}
      onUserMessage={(conversation, text) => {
        threads.nameFromMessage(conversation, text)
        void threads.refresh()
        onStarted?.(conversation, threads.standInTitle(text))
      }}
      session={session}
    />
  )
}
