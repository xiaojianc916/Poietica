import type { AgentSessionPort, SessionConfigControl } from '@poietica/agent-protocol'
import { AssistantSurface } from '@poietica/agent-ui'
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
   * 手伸向输入框，才为这条对话准备一个会话。
   *
   * 选择器属于一个活着的 ACP 会话，而开一个会话是 spawn 进程加两趟握手。把它
   * 挂在「这一格出现了」上，等于把「看一段历史」的代价定成一次进程启动；更糟
   * 的是这些握手在同一条连接上排队（agent_threads 的 doc：a turn in flight
   * 时 agent 连 sessions 都不肯列），于是在列表里连点几条，最后点的那条要等前
   * 面几条握完手 —— 那不是加载慢，那是几个没人要的会话替你排着队。
   *
   * 历史不需要会话：它整段来自本地日志，由 useAssistantSession 自己读。
   *
   * 两个入口都是幂等的（adopt 问过一次就记下不再问，identify 复用同一个
   * promise），所以指针移入和聚焦重复触发是安全的，不需要节流也不需要标志位。
   */
  const engage = () => {
    if (threadId === null) {
      void onIdentify?.()

      return
    }

    threads.adopt(threadId)
  }

  const controls = threadId === null ? NO_CONTROLS : (threads.selectorsOf(threadId) ?? NO_CONTROLS)

  return (
    <AssistantSurface
      controls={controls}
      controlsFailure={threadId === null ? undefined : threads.selectorFailureOf(threadId)}
      endpoint={threadId}
      identify={onIdentify}
      onEngage={engage}
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
