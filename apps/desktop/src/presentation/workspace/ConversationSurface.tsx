import type { AgentSessionPort } from '@poietica/agent-protocol'
import { chooseAgentControl, useAgentControls } from '@poietica/agent-runtime'
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
   * 手伸向一条已有的对话，才为它开一个 ACP 会话。
   *
   * 入口那一格没有身份可以"预先准备"。它此前会在指针移入或聚焦时调用 onIdentify,
   * 也就是拿一次鼠标经过去认领一条真的对话：于是用户什么都还没说，这一格就已经有
   * 了 endpoint，useAssistantSession 在渲染期立刻 opening(endpoint) 并把 isRestoring
   * 置真，输入框跟着落到底部，随后又弹回原位。预取只许影响缓存，不许影响 UI 状态,
   * 而这里它影响的是这一格的身份。
   *
   * 而且它本来就是多余的：身份在发言的那一刻就会取到（useAssistantSession.send 里
   * appendUserMessage → identify() → prompt），提前认领一次，除了多出一条没人要的
   * 对话之外什么也没换来。
   *
   * 已有对话这一路留着：adopt 只是为一条已经存在的对话开会话、拿它的选择器，不改
   * 这一格的身份，因此动不了排版；它是幂等的，重复触发安全。开会话确实贵（spawn
   * 加两趟握手，且在同一条连接上排队），所以它仍然等到手伸过来才做，而不是挂在
   * "这一格出现了"上。
   */
  const engage = () => {
    if (threadId === null) {
      return
    }

    threads.adopt(threadId)
  }

  /*
   * 没有会话的那一格，画的是偏好。
   *
   * 此前它是 NO_CONTROLS —— 一个空数组，于是工具条里那个模型选择器连数据都
   * 没有，画不出来。可"有哪些模型可选"是这个 agent 的能力，不是某条会话的
   * 属性；人想用哪个更是他自己的事。两者都不需要一条对话存在。
   *
   * 已有对话在自己的表到达之前也落在这里：先画已知的那张，而不是先画一个空
   * 工具条再让它长出来。
   */
  const known = useAgentControls()

  const controls = threadId === null ? known : (threads.selectorsOf(threadId) ?? known)

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
        /*
         * 选择先记成偏好，再落到会话上。
         *
         * 记下来的那一份是下一条新对话的默认值 —— 人换了模型，不该在下一次
         * 新建会话时被打回原样。没有会话的时候，它就是这次选择的全部效果，
         * 而 ThreadsStore.create 会在会话开出来时把它补上。
         */
        chooseAgentControl(controlId, value)

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
