import './assistant.css'

import type { ReactNode } from 'react'
import { useAssistantSession } from '../application/useAssistantSession'
import { useSessionControls } from '../application/useSessionControls'
import type { AgentSessionPort } from '../contracts/agent-session-port'
import type { AgentModelsPort } from '../contracts/model-port'
import type { SessionConfigPort } from '../contracts/session-config-port'
import type { TurnOutcome } from '../domain/timeline-selectors'
import { selectFeedRows, selectIsBusy, selectSilentOutcome } from '../domain/timeline-selectors'
import { AgentActivityFeed } from './AgentActivityFeed'
import { AssistantComposer } from './AssistantComposer'
import { AssistantQuickActions } from './AssistantQuickActions'
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
  /** Where the model list is read from before a session exists. */
  readonly models?: AgentModelsPort
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
function renderFooter(isWaiting: boolean, outcome: TurnOutcome | null): ReactNode {
  if (isWaiting) {
    return <ThinkingIndicator />
  }

  if (outcome !== null) {
    return <TurnOutcomeNotice outcome={outcome} />
  }

  return null
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
export function AssistantSurface({ config, endpoint, models, session }: AssistantSurfaceProps) {
  /*
   * Under exactOptionalPropertyTypes an absent property and a property set to
   * undefined are different types, so the key is omitted rather than passed
   * empty.
   */
  const assistant = useAssistantSession({
    endpoint,
    ...(session === undefined ? {} : { session }),
  })

  const controls = useSessionControls(config, models, assistant.status)

  const rows = selectFeedRows(assistant.timeline)
  const started = rows.length > 0

  /*
   * The gap between the question and the first frame of the answer. Derived
   * from the run being open with the transcript ending on the question.
   */
  const isWaiting = assistant.status === 'streaming' && rows.at(-1)?.item.type === 'user_message'
  const outcome = selectSilentOutcome(assistant.timeline)

  return (
    <section
      className="assistant-surface"
      data-assistant-skin
      data-started={started ? 'true' : undefined}
    >
      <AgentActivityFeed
        dock={
          <>
            <div className="assistant-surface__composer">
              <AssistantComposer
                agentLabel="Super Computer"
                controls={controls.controls}
                controlsFailure={controls.failure}
                isAgentNew
                onCancel={assistant.cancel}
                onSelectControl={controls.select}
                onSubmit={assistant.send}
                status={assistant.status}
              />
            </div>

            <div className="assistant-surface__starters" inert={started}>
              <AssistantQuickActions
                onSelect={(actionId) => {
                  assistant.prefill(STARTERS[actionId] ?? '')
                }}
              />
            </div>
          </>
        }
        footer={renderFooter(isWaiting, outcome)}
        header={
          <div className="assistant-surface__intro" inert={started}>
            <header className="assistant-masthead">
              <AgentIcon aria-hidden="true" className="assistant-masthead__mark" />

              <h1 className="assistant-masthead__title">接下来我们做点什么？</h1>
            </header>
          </div>
        }
        isBusy={selectIsBusy(assistant.timeline)}
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
