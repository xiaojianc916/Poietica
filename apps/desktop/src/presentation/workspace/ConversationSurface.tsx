import { type AgentSessionPort, MODEL_CONTROL_ID } from '@poietica/acp'
import {
  chooseAgentControl,
  installAgentCapabilityPort,
  installAgentDefaultModelSource,
  useAgentControls,
} from '@poietica/agent-session'
import { AssistantSurface, installAttachmentIntake } from '@poietica/agent-ui'
import { createAttachmentIntake } from '@poietica/desktop-runtime'
import type { AgentConfigStore } from '@poietica/settings'
import { useCallback, useEffect } from 'react'
import { desktopAgentCapabilities } from '../../application/ai/agent-session'
import {
  useThreadSelectorFailure,
  useThreadSelectors,
  useThreadsActions,
} from '../../application/ai/threads-context'
import { reportFailure } from '../../application/failures/failure-policy'

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
   * 告诉能力表：这一家 agent 有哪些模型，以及怎么读写它的 default_model。
   *
   * 两件事同一个产地（agent 自己那份 config.toml），也同一个时机（换一家就都得
   * 重来），所以它们在同一个 effect 里，依赖同一对 agentConfig / agentId。
   *
   * 交的是函数而不是值：那两次读取该在有人真要看选择器时才发生，而这里是渲染层，
   * 不该替它决定时机。装上是幂等的 —— 端口按 agentId 记着，同一家只问一次。
   */
  useEffect(() => {
    installAgentCapabilityPort(desktopAgentCapabilities(agentConfig, agentId), (cause) => {
      reportFailure('AGENT_CAPABILITIES_UNREADABLE', {
        scope: 'conversation-surface',
        operation: 'read-models',
        cause,
      })
    })

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

  const selectControl = useCallback(
    (controlId: string, value: string) => {
      /*
       * 一条下发路径。
       *
       * 选中什么是全局那一份；哪条会话该被切过去、什么时候切，由 ThreadsStore 的
       * 投影与对齐统一决定（observeAgentControls → #realign → #align），忙的那条
       * 空下来由 onIdle 补发。
       */
      chooseAgentControl(controlId, value)

      /*
       * 模型多一件事：它有家，就是 agent 配置里的顶层 default_model。换模型就是换
       * 默认模型，没有第二个概念，上游的 /model 也是这么做的（persist 恒为 true）。
       *
       * 落盘不等结果就上屏：agent watch 着那个文件，但 watcher 有延迟，回读只会读
       * 到旧值。写失败会自己说出来，而不是让人以为换过了。
       */
      if (controlId !== MODEL_CONTROL_ID) {
        return
      }

      void agentConfig.saveDefaultModel(agentId, value).catch((cause: unknown) => {
        reportFailure('AGENT_DEFAULT_MODEL_SAVE_FAILED', {
          scope: 'conversation-surface',
          operation: 'save-default-model',
          alias: value,
          cause,
        })
      })
    },
    /*
     * 不再依赖 controls：模型那一格的 id 是协议常量，不需要去表里反查。
     * 带着它，这个回调每次表变化都换引用，AssistantSurface 的 memo 一次也命中不了。
     */
    [agentConfig, agentId],
  )

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
      onSelectControl={selectControl}
      onUserMessage={userMessage}
      session={session}
    />
  )
}
