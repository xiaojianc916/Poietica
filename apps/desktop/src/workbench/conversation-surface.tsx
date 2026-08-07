import type { AgentSessionPort } from '@poietica/acp'
import {
  chooseAgentControl,
  installAgentCapabilityPort,
  useAgentControls,
} from '@poietica/agent-session'
import { AssistantSurface, installAttachmentIntake } from '@poietica/agent-ui'
import { createAttachmentIntake } from '@poietica/desktop-adapters'
import type { AgentConfigStore } from '@poietica/settings'
import { useCallback, useEffect } from 'react'
import { desktopAgentCapabilities } from '../assistant/agent-session'
import {
  useThreadSelectorFailure,
  useThreadSelectors,
  useThreadsActions,
} from '../assistant/threads-context'
import { reportFailure } from '../failures/application-policy'

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
  /** 问这一家 agent 提供什么、改它、以及记住模型的那一路。 */
  readonly agentConfig: AgentConfigStore
  /** 写给哪一家 agent。与会话 spawn 的那一家同一个产地。 */
  readonly agentId: string
  /** 取得这一格即将成为的那条对话。只有入口那一格需要它。 */
  readonly onIdentify?: (() => Promise<string | null>) | undefined
  /** 这条对话说出第一句话时，带上它当时的名字。 */
  readonly onStarted?: (threadId: string, title: string) => void
  readonly session: AgentSessionPort
  readonly threadId: string | null
}

/*
 * 输入框的收件口，一个进程一份。
 *
 * 装在模块求值时，不装在 effect 里：它不随任何一条对话变化，而且拖放监听要
 * 在第一次渲染之前就位 —— 与 installAgentCapabilityPort 不同，那一个的内容
 * 随 agentId 变，这一个不变。会话本身仍然是懒开的（见 createAttachmentIntake）。
 */
installAttachmentIntake(createAttachmentIntake())

export function ConversationSurface({
  agentConfig,
  agentId,
  onIdentify,
  onStarted,
  session,
  threadId,
}: ConversationSurfaceProps) {
  const threads = useThreadsActions()

  /*
   * 这一格只关心这两样，所以只订这两样。
   *
   * 两者在真的变化之前都是同一个引用，因此别的对话被打开、agent 报一次表、
   * 侧栏改个名，都不会走到这里。
   */
  const offered = useThreadSelectors(threadId)

  const failure = useThreadSelectorFailure(threadId)

  /*
   * 告诉能力表这一家 agent 从哪里问。
   *
   * 一个产地一个端口：读整张表、改其中一项都走它，落盘 default_model 也在它里面
   * （见 desktopAgentCapabilities）。渲染层因此不认识 default_model 这个概念，也
   * 不再有第二条写它的路。
   *
   * 装上是幂等的 —— 端口按 agentId 记着，store 用端口身份判断换没换一家。
   */
  useEffect(() => {
    installAgentCapabilityPort(desktopAgentCapabilities(agentConfig, agentId), (cause) => {
      reportFailure('AGENT_CAPABILITIES_UNREADABLE', {
        scope: 'conversation-surface',
        operation: 'read-capabilities',
        cause,
      })
    })
  }, [agentConfig, agentId])

  /*
   * 打开一条已有的对话，就为它开一个 ACP 会话。
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
   * 已有对话这一路不一样：adopt 只为一条已经存在的对话开会话、拿它的选择器和它
   * 的经过，不改这一格的身份，因此动不了排版；它是幂等的，重复触发安全。
   *
   * 它此前挂在 onEngage 上 —— 指针移入或聚焦输入框才装载，理由是"开会话贵"。
   * 那个理由在屏幕上的历史还来自本地日志的时候成立：历史另有来源，会话晚一点
   * 开无非是第一句话慢一点。历史改由持有它的 agent 交回来之后，这句权衡的意思
   * 就变成了"不把鼠标移到输入框上，这条对话就永远是一块白板"，而且连加载图标
   * 都不会出现 —— opening() 从没被调用过，isRestoring 一直是假。
   *
   * 打开就是装载。贵也得付，那是这条对话的内容本身。
   */
  useEffect(() => {
    if (threadId === null) {
      return
    }

    threads.adopt(threadId)
  }, [threadId, threads])

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

  const controls = threadId === null ? known : (offered ?? known)

  /*
   * 交下去的每一个回调都钉住标识。
   *
   * AssistantSurface 是 memo 过的，而内联箭头每次渲染都是新引用 —— 那样的 memo
   * 一次也命中不了：这一格但凡重画一次，转录、虚拟列表、输入框整棵树跟着走一遍。
   */
  const retryControls = useCallback(() => {
    if (threadId !== null) {
      threads.retrySelectors(threadId)
    }
  }, [threadId, threads])

  const userMessage = useCallback(
    (conversation: string, text: string) => {
      threads.noteUserMessage(conversation, text)
      onStarted?.(conversation, threads.standInTitle(text))
    },
    [onStarted, threads],
  )

  return (
    <AssistantSurface
      controls={controls}
      controlsFailure={failure}
      endpoint={threadId}
      identify={onIdentify}
      onRetryControls={retryControls}
      onSelectControl={chooseAgentControl}
      onUserMessage={userMessage}
      session={session}
    />
  )
}
