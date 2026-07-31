import type { AgentSessionPort } from '@poietica/agent-protocol'
import {
  installAgentDefaultModelSource,
  setAgentDefaultModel,
  useAgentControls,
} from '@poietica/agent-runtime'
import { AssistantSurface } from '@poietica/agent-ui'
import type { AgentConfigStore } from '@poietica/features-settings'
import { useEffect } from 'react'
import { useSharedThreads } from '../../application/ai/threads-context'
import { reportFailure } from '../../application/failures/failure-policy'

/* ACP 里模型那一项的 id 是协议常量，不是我们起的名字。 */
const MODEL_CONTROL_ID = 'model'

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
  /** 改 default_model 的那一路。选择器选中什么，那里就写什么。 */
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

export function ConversationSurface({
  agentConfig,
  agentId,
  onIdentify,
  onStarted,
  session,
  threadId,
}: ConversationSurfaceProps) {
  const threads = useSharedThreads()

  /*
   * 告诉能力表怎么问 default_model。
   *
   * 交的是一个函数而不是一个值：那一次读取该在有人真要看选择器时才发生，而这里
   * 是渲染层，不该替它决定时机。装上是幂等的，问只会问一次。
   */
  useEffect(() => {
    installAgentDefaultModelSource({
      load: () => agentConfig.loadDefaultModel(agentId),
      save: (alias) => agentConfig.saveDefaultModel(agentId, alias),
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

  const controls = threadId === null ? known : (threads.selectorsOf(threadId) ?? known)

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
        /*
         * 模型只有一条下发路径。
         *
         * 此前这里做了两件事：改全局值，以及自己再 selectControl 一次。而改全局值
         * 本来就会经由 observeAgentControls → ThreadsStore.#realign() → #switchModel()
         * 下发 —— 两条路各打一次 set_config，而「这一条正在跑就先别下发」那道闸只装
         * 在投影那一条上，于是它形同虚设。这里只留改全局值。
         *
         * thought / mode 仍然直接下发：它们没有全局那一份，投影管不着。
         *
         * 换模型就是换默认模型，没有第二个概念：人在选择器里选的那个，就是下一条新
         * 对话会用的那个。上游的 /model 也是这么做的（第四个参数 persist 恒为 true）。
         *
         * 落盘不等结果就上屏：agent watch 着那个文件，但 watcher 有延迟，回读只会读到
         * 旧值。写失败会自己说出来，而不是让人以为换过了。
         */
        if (controlId !== MODEL_CONTROL_ID) {
          if (threadId !== null) {
            threads.selectControl(threadId, controlId, value)
          }

          return
        }

        setAgentDefaultModel(value)

        void agentConfig.saveDefaultModel(agentId, value).catch((cause: unknown) => {
          reportFailure('AGENT_DEFAULT_MODEL_SAVE_FAILED', {
            scope: 'conversation-surface',
            operation: 'save-default-model',
            alias: value,
            cause,
          })
        })
      }}
      onUserMessage={(conversation, text) => {
        threads.nameFromMessage(conversation, text)
        onStarted?.(conversation, threads.standInTitle(text))
      }}
      session={session}
    />
  )
}
