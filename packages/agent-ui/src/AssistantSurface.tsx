import './styles/assistant.css'

import type { AgentSessionPort, SessionConfigControl } from '@poietica/acp'
import { useAssistantSession } from '@poietica/agent-session'
import type { FeedRow, PermissionItem, TurnFooter } from '@poietica/agent-timeline'
import {
  selectFeedRows,
  selectIsBusy,
  selectTurnFooter,
  selectTurns,
} from '@poietica/agent-timeline'
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import { AssistantComposer } from './AssistantComposer'
import { AssistantQuickActions } from './AssistantQuickActions'
import type { PromptInputHandle } from './composer/prompt-input'
import { useAgentDialect } from './domain/agent-dialect'
import {
  buildQuestionDeck,
  isQuestionRequest,
  readQuestionPrompt,
} from './domain/ask-user-question'
import { AgentActivityFeed, type FeedPort } from './feed/AgentActivityFeed'
import { RestoreSpinner } from './feed/RestoreSpinner'
import { ConversationMinimap } from './minimap/ConversationMinimap'
import { PermissionRequest } from './PermissionRequest'
import { modelProviderOf } from './primitives/model-provider'
import { ProviderIcon } from './primitives/provider-icon'
import { QuestionOutcome } from './timeline/QuestionOutcome'
import { ThinkingIndicator } from './timeline/ThinkingIndicator'
import { TimelineRow } from './timeline/TimelineRow'
import { TurnOutcomeNotice } from './timeline/TurnOutcomeNotice'

export interface AssistantSurfaceProps {
  /** 这一格代表的对话。入口那一格在说话之前还不是任何一条。 */
  readonly endpoint: string | null
  /** 取得这一格即将成为的那条对话，在第一句话的时候。 */
  readonly identify?: (() => Promise<string | null>) | undefined
  /**
   * The session this surface talks to.
   *
   * Optional on purpose: without one the surface renders against an inert
   * stub, which is what fixtures and component work need. The desktop app
   * supplies the real IPC-backed port.
   */
  readonly session?: AgentSessionPort
  /**
   * What the user just said.
   *
   * The conversation list names a conversation from its first message,
   * and the surface does not own the list, so it reports it outwards.
   */
  readonly onUserMessage?: ((threadId: string, text: string) => void) | undefined
  /**
   * 这条对话所持有的会话给出的选择器。
   *
   * 它是被交进来的，不是在这里问出来的：选择器属于会话，会话属于对话，而
   * 对话由上层持有。这一层只负责把它画出来。
   */
  readonly controls: readonly SessionConfigControl[]
  readonly controlsFailure?: string | undefined
  readonly onSelectControl: (controlId: string, value: string) => void
  /** 认领或改动失败之后重新问一次。 */
  readonly onRetryControls?: (() => void) | undefined
}

/*
 * What the feed shows when the transcript has nothing to show.
 *
 * Two states have no entries to render and are not nothing: the wait before
 * the first frame, and a turn that ended without producing anything. Both are
 * derived, and both live outside the virtualised transcript.
 */
function renderFooter(footer: TurnFooter | null): ReactNode {
  if (footer === null) {
    return undefined
  }

  return footer.kind === 'waiting' ? (
    <ThinkingIndicator />
  ) : (
    <TurnOutcomeNotice outcome={{ status: footer.status }} />
  )
}

const STARTERS: Readonly<Record<string, string>> = {
  create: '帮我创建 ',
  find: '帮我查找 ',
  research: '帮我研究 ',
}

/*
 * 两个静止态,两棵树,一个输入框。
 *
 * 哪一种静止态生效，由一个显式的相位说了算，不由转录反推：转录是内容，落到
 * 底部是导航，把后者派生自前者，就等于让任何一帧内容变动都能搬动整块构成。
 *
 * 而相位不再只是换一个属性值。此前两态是同一棵树的两种姿势：feed 根上两个
 * 伪元素的 flex-grow 从 1 补间到 0，滚动区从 0 补间到 1，位置因此是一个数字。
 * 数字可以被补间，也就可以被任何一次属性抖动来回搬动 —— 那正是"输入框忽然
 * 落下去又弹回来"的结构成因：中间态在那套结构里是可以表达的。
 *
 * 现在会话态挂滚动区，入口态挂两块自由空间，挂载与卸载不可补间，中间态因此
 * 无法被表达。输入框始终是同一个 DOM 节点，两个相位共用它。
 *
 * 这一层仍然不量任何几何。
 */
export function AssistantSurface({
  controls,
  controlsFailure,
  endpoint,
  identify,
  onRetryControls,
  onSelectControl,
  onUserMessage,
  session,
}: AssistantSurfaceProps) {
  const assistant = useAssistantSession({ endpoint, identify, onUserMessage, session })

  /* 这条对话对面是谁，由组合根说了算；这一层只负责把它的方言交给判据。 */
  const dialect = useAgentDialect()

  /*
   * 开场那张脸，就是下一句话要交给谁的那张脸。
   *
   * 它读的是这一格已经拿在手里的 controls——和工具条那颗胶囊同一份数据，
   * 所以两处永远说同一件事，换模型时一起换，不需要任何同步。
   *
   * 入口相位没有会话，controls 此时是 agent 的已知能力加上人上次的偏好
   * （见 ConversationSurface 的 known），所以这里读得到东西：这正是那条
   * 回退路径存在的理由。读不到就是读不到，ProviderIcon 画中性标记，而不是
   * 一个空盒子。
   */
  const provider = useMemo(() => modelProviderOf(controls), [controls])

  /* Where a starter is written: the draft belongs to the field that holds it. */
  const composer = useRef<PromptInputHandle | null>(null)

  const rows = useMemo(() => selectFeedRows(assistant.timeline), [assistant.timeline])

  const footer = useMemo(() => selectTurnFooter(assistant.timeline), [assistant.timeline])

  /*
   * 待答的那道题：一趟扫描，从末尾往回，走到本轮开头为止。
   *
   * 协议一次只等一个答复 —— agent 在拿到答案之前不会再问，而 permission_resolved
   * 一到就把 resolution 写进那一条（timeline-reducer.ts）。所以历史里的权限行全
   * 是已答的，还在等的那一道必在本轮末尾；走到人说的上一句话就说明这一轮没有在
   * 等谁，可以收手。
   *
   * 此前这里是三趟：一趟 for 扫出全部未决题、一趟 map 出 requestId 集合、一趟
   * filter 把它们从流里摘掉。三趟都以 rows 为依赖，而 rows 每一帧都是新的 ——
   * 于是每一个 token 都要把整条转录走三遍，去找一个恒在末尾的东西。
   *
   * 判据仍在 domain 层：看 optionId 的形状而不是工具名。普通权限请求（批准／
   * 拒绝）不在此列，仍然内联在流里回答。
   */
  const pending = useMemo((): PermissionItem | undefined => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const item = rows[index]?.item

      if (item === undefined) {
        continue
      }

      if (item.type === 'user_message') {
        return undefined
      }

      if (item.type !== 'permission' || item.resolution !== undefined) {
        continue
      }

      if (isQuestionRequest(item, dialect.questions)) {
        return item
      }
    }

    return undefined
  }, [dialect.questions, rows])

  const questionDeck = useMemo(() => {
    if (pending === undefined) {
      return null
    }

    return buildQuestionDeck(
      pending.requestId,
      [
        {
          requestId: pending.requestId,
          prompt: readQuestionPrompt(pending),
          options: pending.options.map((option) => ({
            optionId: option.optionId,
            label: option.name,
          })),
        },
      ],
      dialect.questions,
    )
  }, [dialect.questions, pending])

  /* 摘出去的那一行不再进流，否则同一道题会同时长在两个地方。 */
  const visibleRows = useMemo(
    () => (pending === undefined ? rows : rows.filter((row) => row.item !== pending)),
    [pending, rows],
  )

  /*
   * 轮次读的是屏幕上真正在滚的那个数组。
   *
   * 此前它读 rows，而滚动区拿到的是 visibleRows —— 摘出去一行，两个数组的下标
   * 就错开一位。而 ConversationTurn.rowIndex 正是喂给 virtualizer.scrollToIndex
   * 的那个行号（见 AgentActivityFeed 的 pending 分支）：于是待答提问在场时，点
   * 缩略导航会跳到相邻的那一条，高亮也跟着错轮。
   *
   * 两个数组、一个下标空间，只能有一个。轨道在第一轮出现之前不挂载，所以空态
   * 也不需要在这里判。
   */
  const turns = useMemo(() => selectTurns(visibleRows), [visibleRows])

  /*
   * 入口态与会话态之间只有一次单向转场，判据是一个显式的相位，不是任何派生量。
   *
   * 这里曾经是 settled = started || isRestoring —— 排版由"转录里有几行"加"有没有
   * 请求在飞"反推出来。两个都不是排版该看的东西：
   *
   *   · 转录会被外面塞进来：run 帧上没有 threadId（run-contract.ts 的六个变体全是
   *     { kind, seq, at, ... }），而端口的 subscribe 也不按对话订阅，于是每个挂载
   *     着的界面都会收下别人的帧；它还会被 opening() 清空、被装载回来的那段历史覆盖。
   *     一个会来回变的量，拿来当一次不可逆转场的判据，就一定会来回跑。
   *   · isRestoring 是"有请求在飞"，不是"有东西可看"。加载中的反馈是 RestoreSpinner
   *     的职责，不是把整块构成换掉的理由。
   *
   * 现在只有两个来源，都不可逆：
   *
   *   · 这一格挂载时就带着 endpoint —— 从列表里打开的既存对话，一开始就是会话态。
   *   · 用户在这一格发出过一句话 —— 那一刻才叫"开始了"。
   *
   * 于是幽灵帧、预热、加载、粘贴、聚焦，一概动不了排版。
   */
  /* 一次字符串比较，返回原始值：缓存槽比它包的东西贵，而原始值不需要引用稳定。 */
  const isBusy = selectIsBusy(assistant.timeline)

  const [phase, setPhase] = useState<'entry' | 'live'>(() => (endpoint === null ? 'entry' : 'live'))

  const live = phase === 'live'

  /*
   * 权限行分两路。
   *
   * 提问已经在输入框里答过了，流里剩下的是它的痕迹：一张问题加选项的卡片。
   * 其余的权限请求原样走 PermissionRequest —— 那条路一个像素都没动，批准与
   * 拒绝仍然在流里就地回答。
   */
  /*
   * useCallback：renderPermission 的引用稳定是 renderRow 稳定的前提。
   * 两者任一不稳定都会让虚拟列表的 renderRow prop 每帧都是新函数，即使
   * rows 一个字节没变，可见行也会全部重渲——虚拟化的收益被反转。
   */
  const renderPermission = useCallback(
    (item: PermissionItem) =>
      isQuestionRequest(item, dialect.questions) ? (
        <QuestionOutcome item={item} />
      ) : (
        <PermissionRequest item={item} onResolve={assistant.resolvePermission} />
      ),
    [dialect.questions, assistant.resolvePermission],
  )

  const renderRow = useCallback(
    (row: FeedRow) =>
      row.item.type === 'permission' ? renderPermission(row.item) : <TimelineRow row={row} />,
    [renderPermission],
  )

  /*
   * 浮层的身份跟着轮次走，不跟着每一帧走。
   *
   * 写成内联箭头，滚动区每帧拿到的都是新函数，于是每帧调用一次、把缩略导航的
   * 整棵元素树重建一遍 —— 而它真正依赖的只有 turns，以及滚动区当场交回来的那
   * 两个值。流式输出每个 token 一帧，那就是每个 token 重建一次上百个轮次标记。
   *
   * 这里的 turns 是真稳定的：它由 useMemo 按 visibleRows 记住，不是那种把每帧
   * 都在换的数组写进依赖数组、看起来 memo 了其实没有的写法。
   */
  const overlay = useCallback(
    (port: FeedPort) =>
      turns.length === 0 ? null : (
        <ConversationMinimap activeRow={port.activeRow} onSelect={port.scrollToRow} turns={turns} />
      ),
    [turns],
  )

  /*
   * 输入框只挂一处。
   *
   * 两个相位各挂各的东西,但输入框不属于任何一个相位:它是这一层的孩子,相位切换
   * 时它的 DOM 位置一个字都不变。于是草稿、附件、光标与焦点跨相位存活,转场不
   * 需要任何"切完之后再把焦点抢回来"的补救 —— 那种补救是症状出现之后的纠正,
   * 而这里根本不产生症状。
   */
  const dock = (
    <div className="assistant-surface__composer">
      <AssistantComposer
        controls={controls}
        controlsFailure={controlsFailure}
        handle={composer}
        onAnswerQuestions={(answers) => {
          /*
           * 一道题一个 permission 请求，所以整组答案就是一串 resolvePermission。
           * 面板在最后一题才交出来，中途翻页不回任何东西——回出去的答案收不回
           * 来，而用户要能改。
           */
          for (const answer of answers) {
            assistant.resolvePermission(answer.requestId, answer.optionId)
          }
        }}
        onCancel={assistant.cancel}
        onRetryControls={onRetryControls}
        onSelectControl={onSelectControl}
        onSubmit={(message) => {
          /*
           * 发言就是那次转场。
           *
           * 它先于 send：这一刻起这一格是一段对话，不再是入口，而这件事不该等
           * 任何一帧回来才成立。
           */
          setPhase('live')
          assistant.send(message)
        }}
        questionDeck={questionDeck}
        status={assistant.status}
      />
    </div>
  )

  return (
    <section
      className="assistant-surface"
      data-assistant-skin
      data-restoring={assistant.isRestoring ? 'true' : undefined}
    >
      {/*
       * 回放那段空白里的反馈。
       *
       * 判据里带 rows.length === 0 不是防抖，是归属：这个图标属于"空白"，
       * 不属于"忙碌"。第一批行一到就撤，不等 isRestoring 落下——有内容可看
       * 的时候还在转圈，转的就是空转，而且它会压在正文上。
       */}
      <RestoreSpinner active={assistant.isRestoring && rows.length === 0} />

      {/*
       * 会话态挂滚动区,入口态挂两块自由空间。
       *
       * 输入框的位置因此由结构给出,不由数字给出:滚动区占满剩余空间就把它压到
       * 底,两块自由空间各占一半就把它托到中间。挂载与卸载不可补间,所以"半落"
       * 这个中间态没有任何写法能表达出来 —— 此前它是 flex-grow 的一个中间值。
       *
       * 开场白与快捷入口不再用 inert 让位:它们不在这个相位里,所以它们不在。
       */}
      {live ? (
        <AgentActivityFeed
          footer={renderFooter(footer)}
          isBusy={isBusy}
          overlay={overlay}
          renderRow={renderRow}
          rows={visibleRows}
        />
      ) : (
        <div className="assistant-surface__entry">
          <header className="assistant-masthead">
            <ProviderIcon
              className="assistant-masthead__mark"
              {...(provider === undefined ? {} : { provider })}
            />

            <h1 className="assistant-masthead__title">接下来我们做点什么？</h1>
          </header>
        </div>
      )}

      <div className="assistant-surface__dock">
        {dock}

        {live ? null : (
          <div className="assistant-surface__starters">
            <AssistantQuickActions
              onSelect={(actionId) => {
                const starter = STARTERS[actionId]

                if (starter !== undefined) {
                  composer.current?.setText(starter)
                  composer.current?.focus()
                }
              }}
            />
          </div>
        )}
      </div>

      {/* 输入框下方的另一半自由空间。会话态没有它,所以输入框落在底部。 */}
      {live ? null : <div className="assistant-surface__ballast" />}
    </section>
  )
}
