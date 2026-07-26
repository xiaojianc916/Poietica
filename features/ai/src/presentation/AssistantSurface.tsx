import './assistant-composer.css'

import type { ReactNode } from 'react'

import { AgentActivityFeed } from './AgentActivityFeed'
import { AssistantComposer } from './AssistantComposer'
import { AssistantQuickActions } from './AssistantQuickActions'
import { PermissionRequest } from './PermissionRequest'
import { AgentIcon } from './primitives/icons'
import { ThinkingIndicator } from './timeline/ThinkingIndicator'
import { TimelineRow } from './timeline/TimelineRow'
import { TurnOutcomeNotice } from './timeline/TurnOutcomeNotice'
import type { AgentSessionPort } from '../contracts/agent-session-port'
import type { AgentModelsPort } from '../contracts/model-port'
import type { TurnOutcome } from '../domain/timeline-selectors'
import { selectFeedRows, selectIsBusy, selectSilentOutcome } from '../domain/timeline-selectors'
import { useAgentModels } from '../application/useAgentModels'
import { useAssistantSession } from '../application/useAssistantSession'

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
   * Where the model list is read from and written to.
   *
   * Optional for the same reason the session is: without it the picker has
   * no list and draws nothing, rather than offering a choice this surface
   * cannot carry out.
   */
  readonly models?: AgentModelsPort
}

/*
 * What the feed shows when the transcript has nothing to show.
 *
 * Two states have no entries to render and are not nothing: the wait before
 * the first frame, and a turn that ended without producing anything. Drawing
 * an empty column for either is what made a working session and a broken one
 * look the same. Neither is a timeline entry — both are derived, and both live
 * outside the virtualised canvas.
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

/*
 * Two resting states, and no script between them.
 *
 * Before the first turn two flexible spacers split the free space, so the group
 * rests in the middle. Once a turn exists the spacers give up their share and
 * the feed takes it, which is what carries the composer down: flex-grow is a
 * number, so the browser interpolates the whole layout on its own. The intro
 * blocks collapse through a grid row rather than through a height nobody can
 * animate, and they stay mounted so that nothing can be left behind by an
 * interrupted transition.
 *
 * This is deliberately not a layout animation. Projecting one over a
 * virtualised, contain: strict scroller means measuring it mid-transition,
 * which is what made the previous version stutter and, worse, occasionally
 * leave the feed at zero opacity.
 *
 * Which state applies is derived from the transcript alone. Nothing here tracks
 * whether a turn was ever sent: a state derived from the timeline cannot
 * disagree with it.
 */
export function AssistantSurface({ endpoint, models, session }: AssistantSurfaceProps) {
  /*
   * Under exactOptionalPropertyTypes an absent property and a property set to
   * undefined are different types, so the key is omitted rather than passed
   * empty.
   */
  const assistant = useAssistantSession({
    endpoint,
    ...(session === undefined ? {} : { session }),
  })

  /* The choice belongs to the agent config, so it is loaded, not invented. */
  const picker = useAgentModels(models)

  const rows = selectFeedRows(assistant.timeline)
  const started = rows.length > 0

  /*
   * The gap between the question and the first frame of the answer.
   *
   * Nothing exists to render there, and nothing rendered there is exactly how
   * a working product and a broken one look the same. Derived from the run
   * being open with the transcript ending on the question, so it cannot
   * disagree with the timeline and cannot be left behind by one.
   */
  const isWaiting = assistant.status === 'streaming' && rows.at(-1)?.item.type === 'user_message'
  const outcome = selectSilentOutcome(assistant.timeline)

  return (
    <section
      className="assistant-surface"
      data-assistant-skin
      data-started={started ? 'true' : undefined}
    >
      <div className="assistant-surface__column">
        <div aria-hidden="true" className="assistant-surface__spacer" />

        <div className="assistant-surface__intro" inert={started}>
          <header className="assistant-masthead">
            <AgentIcon aria-hidden="true" className="assistant-masthead__mark" />

            <h1 className="assistant-masthead__title">接下来我们做点什么？</h1>
          </header>
        </div>

        <div className="assistant-surface__feed">
          <AgentActivityFeed
            footer={renderFooter(isWaiting, outcome)}
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
        </div>

        <div className="assistant-surface__composer">
          <AssistantComposer
            agentLabel="Super Computer"
            isAgentNew
            models={picker.models}
            onSelectModel={picker.select}
            onSubmit={assistant.send}
            status={assistant.status}
            {...(picker.activeModelId === undefined ? {} : { activeModelId: picker.activeModelId })}
          />
        </div>

        <div className="assistant-surface__starters" inert={started}>
          <AssistantQuickActions onSelect={() => {}} />
        </div>

        <div aria-hidden="true" className="assistant-surface__spacer" />
      </div>
    </section>
  )
}
