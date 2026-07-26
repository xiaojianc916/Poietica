import { useState } from 'react'

import { ChevronDownIcon } from '../primitives/icons'

export interface ReasoningPanelProps {
  readonly text: string
  readonly isStreaming: boolean
}

/**
 * The thought chain.
 *
 * Open while the agent is thinking, closed once it has moved on — that is what
 * a reader wants without asking. A click is an opinion, and from then on it
 * outranks the default, which is why the override is state and the default is
 * derived rather than synchronised in an effect.
 */
export function ReasoningPanel({ text, isStreaming }: ReasoningPanelProps) {
  const [override, setOverride] = useState<boolean | null>(null)
  const isOpen = override ?? isStreaming

  return (
    <div className="timeline-reasoning" data-open={isOpen ? 'true' : undefined}>
      <button
        aria-expanded={isOpen}
        className="timeline-reasoning__toggle"
        onClick={() => setOverride(!isOpen)}
        type="button"
      >
        <ChevronDownIcon aria-hidden="true" className="timeline-reasoning__chevron" />
        <span>{isStreaming ? '正在思考' : '思考过程'}</span>
      </button>

      {isOpen ? <p className="timeline-reasoning__body">{text}</p> : null}
    </div>
  )
}
