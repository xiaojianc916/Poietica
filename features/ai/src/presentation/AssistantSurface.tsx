import './assistant-composer.css'

import { useId, useState } from 'react'

import { AssistantComposer } from './AssistantComposer'
import { AssistantQuickActions } from './AssistantQuickActions'
import { MODEL_MARKS } from './primitives/model-icons'
import { useAssistantSession } from '../application/useAssistantSession'
import { ASSISTANT_MODELS, DEFAULT_ASSISTANT_MODEL_ID } from '../domain/model-catalog'

export interface AssistantSurfaceProps {
  readonly endpoint: string
}

/**
 * Masthead, composer and quick actions are siblings in a single column bound
 * to --cp-grid, so their edges align by construction. The masthead mark is the
 * artwork of whichever model is selected — remount it on change (key) so the
 * entrance animation plays.
 */
export function AssistantSurface({ endpoint }: AssistantSurfaceProps) {
  const session = useAssistantSession({ endpoint })
  const [modelId, setModelId] = useState(DEFAULT_ASSISTANT_MODEL_ID)

  const columnId = `${useId()}-column`
  const activeModel = ASSISTANT_MODELS.find((model) => model.id === modelId) ?? ASSISTANT_MODELS[0]
  const ActiveMark = MODEL_MARKS[activeModel.brand]

  return (
    <section className="assistant-surface" data-assistant-skin>
      <div className="assistant-surface__column" id={columnId}>
        <header className="assistant-masthead">
          <ActiveMark className="assistant-masthead__mark" key={activeModel.id} />

          <h1 className="assistant-masthead__title">接下来我们做点什么？</h1>
        </header>

        <AssistantComposer
          agentLabel="Super Computer"
          columnId={columnId}
          isAgentNew
          modelId={modelId}
          models={ASSISTANT_MODELS}
          onModelChange={setModelId}
          onSubmit={session.send}
          status={session.status}
        />

        <AssistantQuickActions onSelect={() => {}} />
      </div>
    </section>
  )
}
