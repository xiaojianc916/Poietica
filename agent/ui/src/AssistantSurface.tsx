import './assistant.css'

import type { AgentSessionPort, SessionConfigControl } from '@poietica/agent-protocol'
import { useAssistantSession } from '@poietica/agent-runtime'
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
import { AgentActivityFeed } from './feed/AgentActivityFeed'
import { RestoreSpinner } from './feed/RestoreSpinner'
import { ConversationMinimap } from './minimap/ConversationMinimap'
import { PermissionRequest } from './PermissionRequest'
import { AgentIcon } from './primitives/icons'
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
  /**
   * 人把手伸向输入框了。
   *
   * 这一层不知道那要准备什么，它只报告意图。指针移入和聚焦都算：键盘用户不会
   * 移入，而移入的人多半还没聚焦 —— 两个都接才既不漏也不早。
   */
  readonly onEngage?: (() => void) | undefined
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
  onEngage,
  onRetryControls,
  onSelectControl,
  onUserMessage,
  session,
}: AssistantSurfaceProps) {
  const assistant = useAssistantSession({ endpoint, identify, onUserMessage, session })

  /* 这条对话对面是谁，由组合根说了算；这一层只负责把它的方言交给判据。 */
  const dialect = useAgentDialect()

  /* Where a starter is written: the draft belongs to the field that holds it. */
  const composer = useRef<PromptInputHandle | null>(null)

  const rows = useMemo(() => selectFeedRows(assistant.timeline), [assistant.timeline])

  /*
   * The rail indexes turns, so before the first one there is nothing to index
   * and it is not mounted at all: the resting state carries no overlay, no
   * listener and no markup for one.
   */
  const turns = useMemo(() => selectTurns(rows), [rows])

  const footer = useMemo(() => selectTurnFooter(assistant.timeline), [assistant.timeline])

  /*
   * 待答的提问从流里摘出来，交给输入框。
   *
   * 判据在 domain 层，看的是 optionId 的形状而不是工具名：q0_opt_0 / q0_skip
   * 这套命名空间是 kimi-code 的 ACP adapter 自己造的，稳定，而工具名在不同
   * agent 与版本下写法不一。它今天一次只发一道题（多题被 adapter 降级），所以
   * 题组恒为 1 题、面板显示 1/1；等上游放开多题，这里和面板都不用改。
   *
   * 只摘 pending 的。已答的那条留在流里，由 PermissionRequest 渲染成
   * "已选择：X" —— 那就是答完之后留下的痕迹。
   *
   * 普通权限请求（批准/拒绝）不在此列，仍然内联在流里回答。
   */
  const pendingQuestions = useMemo(() => {
    /*
     * 元素类型由 PermissionItem 说了算，不由判据说了算。
     *
     * isQuestionRequest 回答的是"是不是一道题"，它的参数刻意放得宽（只认
     * optionId 的形状，不绑死任何一个契约类型）。让它顺便兼任"这是什么类型"，
     * 整张表就会塌成 any —— 类型不是从这里漏的，是从这里被交出去的。
     */
    const found: PermissionItem[] = []

    for (const row of rows) {
      const item = row.item

      if (item.type !== 'permission') {
        continue
      }

      /* 已经答过的留在流里，由痕迹卡片渲染；输入框只接待还在等的。 */
      if (item.resolution !== undefined) {
        continue
      }

      if (!isQuestionRequest(item, dialect.questions)) {
        continue
      }

      found.push(item)
    }

    return found
  }, [dialect.questions, rows])

  /*
   * requestId 集合，供 visibleRows 排除用。
   *
   * pendingQuestions 已经用同一判据扫过一遍 rows；visibleRows 此前再扫
   * 一遍，两趟判据完全等价。Set 查找把第二趟降为 O(1)，判据也收敛到
   * 一处，两者不再需要同步。
   */
  const pendingIds = useMemo(
    () => new Set(pendingQuestions.map((item) => item.requestId)),
    [pendingQuestions],
  )

  const questionDeck = useMemo(() => {
    const first = pendingQuestions[0]

    if (first === undefined) {
      return null
    }

    return buildQuestionDeck(
      first.requestId,
      pendingQuestions.map((item) => ({
        requestId: item.requestId,
        prompt: readQuestionPrompt(item),
        options: item.options.map((option) => ({
          optionId: option.optionId,
          label: option.name,
        })),
      })),
      dialect.questions,
    )
  }, [dialect.questions, pendingQuestions])

  /* 摘出去的那几行不再进流，否则同一道题会同时长在两个地方。 */
  const visibleRows = useMemo(
    () =>
      questionDeck === null
        ? rows
        : rows.filter(
            (row) =>
              !(
                row.item.type === 'permission' &&
                row.item.resolution === undefined &&
                pendingIds.has(row.item.requestId)
              ),
          ),
    [pendingIds, questionDeck, rows],
  )

  /*
   * 入口态与会话态之间只有一次单向转场，判据是一个显式的相位，不是任何派生量。
   *
   * 这里曾经是 settled = started || isRestoring —— 排版由"转录里有几行"加"有没有
   * 请求在飞"反推出来。两个都不是排版该看的东西：
   *
   *   · 转录会被外面塞进来：run 帧上没有 threadId（run-contract.ts 的六个变体全是
   *     { kind, seq, at, ... }），而端口的 subscribe 也不按对话订阅，于是每个挂载
   *     着的界面都会收下别人的帧；它还会被 opening() 清空、被 loadThread 覆盖。
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
  const isBusy = useMemo(() => selectIsBusy(assistant.timeline), [assistant.timeline])

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
   * 输入框只挂一处。
   *
   * 两个相位各挂各的东西,但输入框不属于任何一个相位:它是这一层的孩子,相位切换
   * 时它的 DOM 位置一个字都不变。于是草稿、附件、光标与焦点跨相位存活,转场不
   * 需要任何"切完之后再把焦点抢回来"的补救 —— 那种补救是症状出现之后的纠正,
   * 而这里根本不产生症状。
   */
  const dock = (
    <div
      className="assistant-surface__composer"
      onFocusCapture={onEngage}
      onPointerEnter={onEngage}
    >
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
          onReachStart={assistant.reachStart}
          overlay={(port) =>
            turns.length === 0 ? null : (
              <ConversationMinimap
                activeRow={port.activeRow}
                onSelect={port.scrollToRow}
                turns={turns}
              />
            )
          }
          renderRow={renderRow}
          rows={visibleRows}
        />
      ) : (
        <div className="assistant-surface__entry">
          <header className="assistant-masthead">
            <AgentIcon aria-hidden="true" className="assistant-masthead__mark" />

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
