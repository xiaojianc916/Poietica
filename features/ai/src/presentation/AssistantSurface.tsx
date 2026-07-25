import './assistant-composer.css'

import { useState } from 'react'

import { AssistantComposer } from './AssistantComposer'
import { AssistantQuickActions } from './AssistantQuickActions'
import { AsteriskMark } from './primitives/icons'
import { useAssistantSession } from '../application/useAssistantSession'

export interface AssistantSurfaceProps {
  readonly endpoint: string
}

export function AssistantSurface({ endpoint }: AssistantSurfaceProps) {
  const session = useAssistantSession({ endpoint })
  const [, setLastQuickAction] = useState<string | null>(null)

  return (
    <section className="assistant-surface" data-assistant-skin>
      <div className="assistant-surface__column">
        <header className="assistant-masthead">
          <AsteriskMark aria-hidden="true" className="assistant-masthead__mark" />

          <h1 className="assistant-masthead__title">接下来我们做点什么？</h1>
        </header>

        <AssistantComposer
          agentLabel="Super Computer"
          isAgentNew
          onSubmit={session.send}
          status={session.status}
        />

        <AssistantQuickActions
          onSelect={(actionId) => {
            setLastQuickAction(actionId)
          }}
        />
      </div>
    </section>
  )
}
