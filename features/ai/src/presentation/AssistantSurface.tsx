import './assistant-composer.css'

import { AssistantComposer } from './AssistantComposer'
import { AssistantQuickActions } from './AssistantQuickActions'
import { AssistantMark } from './primitives/AssistantMark'
import { useAssistantSession } from '../application/useAssistantSession'

export interface AssistantSurfaceProps {
  readonly endpoint: string
}

export function AssistantSurface({ endpoint }: AssistantSurfaceProps) {
  const session = useAssistantSession({ endpoint })

  return (
    <section className="assistant-surface" data-assistant-skin>
      <div className="assistant-surface__column">
        <header className="assistant-masthead">
          <AssistantMark className="assistant-masthead__mark" />

          <h1 className="assistant-masthead__title">接下来我们做点什么？</h1>
        </header>

        <AssistantComposer
          agentLabel="Super Computer"
          isAgentNew
          onSubmit={session.send}
          status={session.status}
        />

        <AssistantQuickActions onSelect={session.applyQuickAction} />
      </div>
    </section>
  )
}
