import { useState } from 'react'

import { ChevronDownIcon, ThinkingIcon } from '../primitives/icons'
import { Prose } from './Prose'

export interface ReasoningPanelProps {
  readonly text: string
  readonly isStreaming: boolean
  /** How long the chain took, once the reducer has sealed it. */
  readonly durationMs?: number
}

/**
 * The thought chain.
 *
 * Not a card: a card would give a passing remark the same weight as an answer.
 * One quiet line that can be opened, and the thinking underneath it — rendered
 * by the same pipeline as the answer, because it is the same kind of content.
 * A model that reasons in lists and backticks is displayed reasoning in lists
 * and backticks; a notch smaller and to a narrower measure, so it reads as an
 * aside without being a different medium.
 *
 * Open while the agent is thinking, closed once it has moved on — that is what
 * a reader wants without asking. A click is an opinion, and from then on it
 * outranks the default, which is why the override is state and the default is
 * derived rather than synchronised in an effect.
 *
 * The prose is always mounted: unmounting it is why the panel used to snap
 * open, as there is nothing to animate between a node and no node. It lives in
 * a grid row that travels between 0fr and 1fr, the one way an intrinsic height
 * animates without being measured in script. Closed, the row is inert, so its
 * content is out of reach of the keyboard and of a screen reader.
 */
export function ReasoningPanel({ durationMs, isStreaming, text }: ReasoningPanelProps) {
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
        <ThinkingIcon aria-hidden="true" className="timeline-reasoning__mark" />

        <span className="timeline-reasoning__label">{labelOf(isStreaming, durationMs)}</span>

        <ChevronDownIcon aria-hidden="true" className="timeline-reasoning__chevron" />
      </button>

      <div className="timeline-reasoning__reveal" inert={!isOpen}>
        <div className="timeline-reasoning__clip">
          <Prose className="timeline-reasoning__body" isStreaming={isStreaming} text={text} />
        </div>
      </div>
    </div>
  )
}

/*
 * A duration is stated only when one was recorded, and never as `0 秒`: the
 * shortest chain still took a moment, so it rounds up to one second.
 */
function labelOf(isStreaming: boolean, durationMs?: number): string {
  if (isStreaming) {
    return '正在思考'
  }
  if (durationMs === undefined) {
    return '思考过程'
  }
  return `思考了 ${String(Math.max(1, Math.round(durationMs / 1000)))} 秒`
}
