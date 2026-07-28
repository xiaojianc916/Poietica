import { DisclosureBody, useDisclosure } from '../primitives/disclosure'
import { ChevronDownIcon, ThinkingIcon } from '../primitives/icons'
import { Prose } from './Prose'
import { useScrollFade } from './use-scroll-fade'

export interface ReasoningPanelProps {
  readonly text: string
  readonly isStreaming: boolean
}

/**
 * The thought chain.
 *
 * Not a card: a card would give a passing remark the same weight as an answer.
 * One quiet line that can be opened, and the thinking underneath it — rendered
 * by the same pipeline as the answer, because it is the same kind of content.
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
 *
 * A long chain scrolls within a capped box rather than pushing the answer down
 * the page. The cap is a maximum, so a short chain has no scroller and no faded
 * edge; the fade itself is the stylesheet's business, from the edges this hook
 * measures.
 */
export function ReasoningPanel({ isStreaming, text }: ReasoningPanelProps) {
  const { isOpen, toggle } = useDisclosure(isStreaming)
  const scrollFadeRef = useScrollFade()

  return (
    <div className="timeline-reasoning" data-open={isOpen ? 'true' : undefined}>
      <button
        aria-expanded={isOpen}
        className="timeline-reasoning__toggle"
        onClick={toggle}
        type="button"
      >
        <ThinkingIcon aria-hidden="true" className="timeline-reasoning__mark" />

        <span className="timeline-reasoning__label">{isStreaming ? '正在思考' : '思考完毕'}</span>

        <ChevronDownIcon aria-hidden="true" className="timeline-reasoning__chevron" />
      </button>

      <DisclosureBody block="timeline-reasoning" isOpen={isOpen}>
        <div className="timeline-reasoning__scroll" ref={scrollFadeRef}>
          <Prose className="timeline-reasoning__body" isStreaming={isStreaming} text={text} />
        </div>
      </DisclosureBody>
    </div>
  )
}
