import type { AgentSessionPort, SessionConfigControl } from '@poietica/agent-protocol'
import { AssistantSurface } from '@poietica/agent-ui'
import { useEffect } from 'react'
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

/** 还不知道这条对话有什么可选时画的东西：什么都不画。 */
const NO_CONTROLS: readonly SessionConfigControl[] = []

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

  /*
   * 选择器跟着对话走。
   *
   * 本次运行开出来的对话，在 agent_open_thread 的答复里就带回了整张表；从列
   * 表里点开的那些不是本次开的，所以在这里认领一次。认领至多发生一次，之后
   * 它只被"改"这一条路更新。
   */
  useEffect(() => {
    if (threadId !== null) {
      threads.adopt(threadId)
    }
  }, [threadId, threads])

  const controls = threadId === null ? NO_CONTROLS : (threads.selectorsOf(threadId) ?? NO_CONTROLS)

  return (
    <AssistantSurface
      controls={controls}
      controlsFailure={threadId === null ? undefined : threads.selectorFailureOf(threadId)}
      endpoint={threadId}
      identify={onIdentify}
      onRetryControls={() => {
        if (threadId !== null) {
          threads.retrySelectors(threadId)
        }
      }}
      onSelectControl={(controlId, value) => {
        if (threadId !== null) {
          threads.selectControl(threadId, controlId, value)
        }
      }}
      onUserMessage={(conversation, text) => {
        threads.nameFromMessage(conversation, text)
        onStarted?.(conversation, threads.standInTitle(text))
      }}
      session={session}
    />
  )
}
