import './assistant-composer.css'

import { useId } from 'react'

import { AgentActivityFeed } from './AgentActivityFeed'
import { AssistantComposer } from './AssistantComposer'
import { TimelineRow } from './timeline/TimelineRow'
import { AssistantQuickActions } from './AssistantQuickActions'
import { PermissionRequest } from './PermissionRequest'
import { AgentIcon } from './primitives/icons'
import type { AgentSessionPort } from '../contracts/agent-session-port'
import { selectFeedRows, selectIsBusy } from '../domain/timeline-selectors'
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
}

/**
 * Masthead, composer and quick actions are siblings in one column bound to
 * --cp-grid, so their edges align by construction.
 */
export function AssistantSurface({ endpoint, session }: AssistantSurfaceProps) {
  /*
   * Under exactOptionalPropertyTypes an absent property and a property set to
   * undefined are different types, so the key is omitted rather than passed
   * empty.
   */
  const assistant = useAssistantSession({
    endpoint,
    ...(session === undefined ? {} : { session }),
  })

  const rows = selectFeedRows(assistant.timeline)

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
        ) : null}

        <AssistantComposer
          agentLabel="Super Computer"
          columnId={columnId}
          isAgentNew
          onSubmit={assistant.send}
          status={assistant.status}
        />

        <AssistantQuickActions onSelect={() => {}} />
      </div>
    </section>
  )
}
