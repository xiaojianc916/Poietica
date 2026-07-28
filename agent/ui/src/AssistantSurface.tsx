import './assistant.css'

import type { AgentSessionPort, SessionConfigPort } from '@poietica/agent-protocol'
import { defaultAcpAgent } from '@poietica/agent-registry'
import { useAssistantSession, useSessionControls } from '@poietica/agent-runtime'
import type { PermissionItem, TurnFooter } from '@poietica/agent-timeline'
import {
  selectFeedRows,
  selectIsBusy,
  selectTurnFooter,
  selectTurns,
} from '@poietica/agent-timeline'
import { type ReactNode, useMemo, useRef } from 'react'
import { AssistantComposer } from './AssistantComposer'
import { AssistantQuickActions } from './AssistantQuickActions'
import type { PromptInputHandle } from './composer/prompt-input'
import {
  buildQuestionDeck,
  isQuestionRequest,
  readQuestionPrompt,
} from './domain/ask-user-question'
import { AgentActivityFeed } from './feed/AgentActivityFeed'
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
  /** The selectors the running session offers. */
  readonly config?: SessionConfigPort
}

/*
 * What the feed shows when the transcript has nothing to show.
 *
 * Two states have no entries to render and are not nothing: the wait before
 * the first frame, and a turn that ended without producing anything. Both are
 * derived, and both live outside the virtualised canvas.
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

/*
 * 工具条上那一格说的是即将说话的那个 agent。
 *
 * 它此前写死成 Super Computer —— 一个没有出处的名字：不是 registry 里的条目，
 * 不是 agent 通过 ACP 自报的标题，也不是任何配置项，换一个 agent 它也不会变。
 * 名字的出处只有一个，就是 registry；解析它没有副作用，所以在模块层问一次。
 */
const AGENT = defaultAcpAgent()

const STARTERS: Readonly<Record<string, string>> = {
  create: '帮我创建 ',
  find: '帮我查找 ',
  research: '帮我研究 ',
}

/*
 * One scroller, one dock.
 *
 * The panel scrolls, not a box inside it, so the intro, the transcript and the
 * composer are all part of the same flow: the scrollbar runs the full height of
 * the panel against its edge, and the composer floats over the run as a sticky
 * band that still holds its own space at rest. The surface therefore composes
 * three slots and owns no geometry of its own.
 *
 * Which resting state applies is derived from the transcript alone, so it
 * cannot disagree with it; the travel between the two is a flex-grow
 * interpolation in the stylesheet, with nothing measured in script.
 */
export function AssistantSurface({
  config,
  endpoint,
  identify,
  onUserMessage,
  session,
}: AssistantSurfaceProps) {
  const assistant = useAssistantSession({ endpoint, identify, onUserMessage, session })

  /*
   * 选择器属于会话，会话属于这一格代表的那条对话，所以它既是重读的
   * 理由，也是问出去的那句话的主语。
   *
   * 此前它只是个「变了就重读」的标记，问句本身没有主语：在第二条对
   * 话里换模型，换的是第一条的。
   */
  const controls = useSessionControls(config, endpoint)

  /* Where a starter is written: the draft belongs to the field that holds it. */
  const composer = useRef<PromptInputHandle | null>(null)

  const rows = useMemo(() => selectFeedRows(assistant.timeline), [assistant.timeline])
  const started = rows.length > 0

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

      if (!isQuestionRequest(item)) {
        continue
      }

      found.push(item)
    }

    return found
  }, [rows])

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
    )
  }, [pendingQuestions])

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
                isQuestionRequest(row.item)
              ),
          ),
    [questionDeck, rows],
  )

  /*
   * 正在读一条已有对话时也按“已开始”排版。
   *
   * 列表里的对话必然说过话，所以最终形态是已知的：先按它排，回放到达时
   * 没有任何状态翻转，也就没有“内容从上面掉下来”和输入框那一抖。真的读出
   * 空记录时才回落到起始态，而那几帧的过渡由 data-restoring 关掉。
   */
  const settled = started || assistant.isRestoring

  /*
   * 权限行分两路。
   *
   * 提问已经在输入框里答过了，流里剩下的是它的痕迹：一张问题加选项的卡片。
   * 其余的权限请求原样走 PermissionRequest —— 那条路一个像素都没动，批准与
   * 拒绝仍然在流里就地回答。
   */
  const renderPermission = (item: PermissionItem) =>
    isQuestionRequest(item) ? (
      <QuestionOutcome item={item} />
    ) : (
      <PermissionRequest item={item} onResolve={assistant.resolvePermission} />
    )

  return (
    <section
      className="assistant-surface"
      data-assistant-skin
      data-restoring={assistant.isRestoring ? 'true' : undefined}
      data-started={settled ? 'true' : undefined}
    >
      <AgentActivityFeed
        dock={
          <>
            <div className="assistant-surface__composer">
              <AssistantComposer
                agentLabel={AGENT.displayName}
                controls={controls.controls}
                controlsFailure={controls.failure}
                handle={composer}
                onAnswerQuestions={(answers) => {
                  /*
                   * 一道题一个 permission 请求，所以整组答案就是一串
                   * resolvePermission。面板在最后一题才交出来，中途翻页不回
                   * 任何东西——回出去的答案收不回来，而用户要能改。
                   */
                  for (const answer of answers) {
                    assistant.resolvePermission(answer.requestId, answer.optionId)
                  }
                }}
                onCancel={assistant.cancel}
                onRetryControls={controls.retry}
                onSelectControl={controls.select}
                onSubmit={assistant.send}
                questionDeck={questionDeck}
                status={assistant.status}
              />
            </div>

            <div className="assistant-surface__starters" inert={started}>
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
          </>
        }
        footer={renderFooter(footer)}
        header={
          <div className="assistant-surface__intro" inert={started}>
            <header className="assistant-masthead">
              <AgentIcon aria-hidden="true" className="assistant-masthead__mark" />

              <h1 className="assistant-masthead__title">接下来我们做点什么？</h1>
            </header>
          </div>
        }
        isBusy={selectIsBusy(assistant.timeline)}
        overlay={(port) =>
          turns.length === 0 ? null : (
            <ConversationMinimap
              activeRow={port.activeRow}
              onSelect={port.scrollToRow}
              turns={turns}
            />
          )
        }
        renderRow={(row) =>
          row.item.type === 'permission' ? renderPermission(row.item) : <TimelineRow row={row} />
        }
        rows={visibleRows}
      />
    </section>
  )
}
