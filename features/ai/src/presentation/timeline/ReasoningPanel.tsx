import { useState } from 'react'

import { ChevronDownIcon } from '../primitives/icons'

export interface ReasoningPanelProps {
  readonly text: string
  readonly isStreaming: boolean
}

/**
 * The thought chain, as a drawer.
 *
 * Open while the agent is thinking, closed once it has moved on — that is what
 * a reader wants without asking. A click is an opinion, and from then on it
 * outranks the default, which is why the override is state and the default is
 * derived rather than synchronised in an effect.
 *
 * The text is always mounted. Unmounting it on close is why the panel used to
 * snap: there is nothing to animate between a node and no node. It lives inside
 * a grid row that travels between 0fr and 1fr instead, which is the one way an
 * intrinsic height animates without being measured in script. Closed, the row
 * is inert, so its content is out of reach of the keyboard and of a screen
 * reader while it is not visible.
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
        <span className="timeline-reasoning__label">{isStreaming ? '正在思考' : '思考过程'}</span>

        <ChevronDownIcon aria-hidden="true" className="timeline-reasoning__chevron" />
      </button>

      <div className="timeline-reasoning__reveal" inert={!isOpen}>
        <div className="timeline-reasoning__clip">
          <p className="timeline-reasoning__body">{text}</p>
        </div>
      </div>
    </div>
  )
}
