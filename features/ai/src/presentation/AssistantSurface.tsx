import './assistant.css'

import { type ReactNode, useMemo, useRef } from 'react'

import { useAssistantSession } from '../application/useAssistantSession'
import { useSessionControls } from '../application/useSessionControls'
import type { AgentSessionPort } from '../contracts/agent-session-port'
import type { SessionConfigPort } from '../contracts/session-config-port'
import type { TurnFooter } from '../domain/timeline-selectors'
import {
  selectFeedRows,
  selectIsBusy,
  selectTurnFooter,
  selectTurns,
} from '../domain/timeline-selectors'
import { AssistantComposer } from './AssistantComposer'
import { AssistantQuickActions } from './AssistantQuickActions'
import type { PromptInputHandle } from './composer/prompt-input'
import { AgentActivityFeed } from './feed/AgentActivityFeed'
import { ConversationMinimap } from './minimap/ConversationMinimap'
import { PermissionRequest } from './PermissionRequest'
import { AgentIcon } from './primitives/icons'
import { ThinkingIndicator } from './timeline/ThinkingIndicator'
import { TimelineRow } from './timeline/TimelineRow'
import { TurnOutcomeNotice } from './timeline/TurnOutcomeNotice'

export interface AssistantSurfaceProps {
  readonly endpoint: string
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
  readonly onUserMessage?: (text: string) => void
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
  onUserMessage,
  session,
}: AssistantSurfaceProps) {
  const assistant = useAssistantSession({ endpoint, session })

  /*
   * 选择器属于会话，会话属于对话，所以重读的理由是换了对话。
   *
   * 此前这里传的是回合状态，而它一轮要变三次，于是读一次列表 ——
   * 也就是 ensure_session —— 会在回答进行中被反复触发。
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
   * 正在读一条已有对话时也按“已开始”排版。
   *
   * 列表里的对话必然说过话，所以最终形态是已知的：先按它排，回放到达时
   * 没有任何状态翻转，也就没有“内容从上面掉下来”和输入框那一抖。真的读出
   * 空记录时才回落到起始态，而那几帧的过渡由 data-restoring 关掉。
   */
  const settled = started || assistant.isRestoring

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
                agentLabel="Super Computer"
                controls={controls.controls}
                controlsFailure={controls.failure}
                handle={composer}
                isAgentNew
                onCancel={assistant.cancel}
                onRetryControls={controls.retry}
                onSelectControl={controls.select}
                onSubmit={assistant.send}
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
          row.item.type === 'permission' ? (
            <PermissionRequest item={row.item} onResolve={assistant.resolvePermission} />
          ) : (
            <TimelineRow row={row} />
          )
        }
        rows={rows}
      />
    </section>
  )
}
