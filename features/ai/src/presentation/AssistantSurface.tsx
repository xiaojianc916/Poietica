import './assistant-composer.css'

import { useId } from 'react'

import { AgentActivityFeed } from './AgentActivityFeed'
import { AssistantComposer } from './AssistantComposer'
import { TimelineItemPreview } from './TimelineItemPreview'
import { AssistantQuickActions } from './AssistantQuickActions'
import { AgentIcon } from './primitives/icons'
import { selectFeedRows, selectIsBusy } from '../domain/timeline-selectors'
import { useAssistantSession } from '../application/useAssistantSession'

export interface AssistantSurfaceProps {
  readonly endpoint: string
}

/**
 * Masthead, composer and quick actions are siblings in one column bound to
 * --cp-grid, so their edges align by construction.
 *
 * The masthead used to show the artwork of the selected model. There is no
 * selected model any more, so it shows the agent mark instead, on the same
 * class the stylesheet already sizes and animates.
 */
export function AssistantSurface({ endpoint }: AssistantSurfaceProps) {
  const session = useAssistantSession({ endpoint })
  const rows = selectFeedRows(session.timeline)

  const columnId = `${useId()}-column`

  return (
    <section className="assistant-surface" data-assistant-skin>
      <div className="assistant-surface__column" id={columnId}>
        <header className="assistant-masthead">
          <AgentIcon aria-hidden="true" className="assistant-masthead__mark" />

          <h1 className="assistant-masthead__title">接下来我们做点什么？</h1>
        </header>

        {rows.length > 0 ? (
          <AgentActivityFeed
            isBusy={selectIsBusy(session.timeline)}
            renderRow={(row) => <TimelineItemPreview row={row} />}
            rows={rows}
          />
        ) : null}

        <AssistantComposer
          agentLabel="Super Computer"
          columnId={columnId}
          isAgentNew
          onSubmit={session.send}
          status={session.status}
        />

        <AssistantQuickActions onSelect={() => {}} />
      </div>
    </section>
  )
}
