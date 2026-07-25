import './assistant-composer.css'

import { useState } from 'react'

import { AssistantComposer } from './AssistantComposer'
import type { AssistantModelOption } from './AssistantComposer'
import { AssistantQuickActions } from './AssistantQuickActions'
import { AssistantMark } from './primitives/AssistantMark'
import { useAssistantSession } from '../application/useAssistantSession'

const MODELS: readonly AssistantModelOption[] = [
  { id: 'sonnet-4.5', label: 'Sonnet 4.5' },
  { id: 'opus-4.1', label: 'Opus 4.1' },
  { id: 'gpt-5.1', label: 'GPT-5.1' },
]

export interface AssistantSurfaceProps {
  readonly endpoint: string
}

export function AssistantSurface({ endpoint }: AssistantSurfaceProps) {
  const session = useAssistantSession({ endpoint })
  const [modelId, setModelId] = useState(MODELS[0].id)

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
          modelId={modelId}
          models={MODELS}
          onModelChange={setModelId}
          onSubmit={session.send}
          status={session.status}
        />

        <AssistantQuickActions onSelect={() => {}} />
      </div>
    </section>
  )
}
