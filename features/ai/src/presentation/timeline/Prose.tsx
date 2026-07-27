import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { Streamdown } from 'streamdown'

/*
 * Plugins are declared once, at module scope.
 *
 * Streamdown reads this object on every render, and a fresh object per frame
 * would defeat its memoisation mid-stream.
 *
 * math and mermaid are installed but not wired: math additionally requires
 * katex's stylesheet, which this workspace does not resolve.
 */
const PLUGINS = { cjk, code }

export interface ProseProps {
  readonly text: string
  readonly isStreaming: boolean
  /** A place in the timeline, for measure and scale. Never for typography. */
  readonly className?: string
}

/**
 * Markdown from the model, wherever it appears.
 *
 * The answer and the thought chain are the same kind of content — a markdown
 * stream, half written until it is not — so they are rendered by one component
 * rather than by two that drift apart. `timeline-prose` is the single scope the
 * stylesheet dresses, which is why a fenced block inside the thinking already
 * looks like a fenced block inside the answer.
 *
 * While text is still arriving Streamdown is told so, and closes the open
 * constructs itself rather than letting a lone fence swallow the rest.
 */
export function Prose({ className, isStreaming, text }: ProseProps) {
  return (
    <div
      className={className === undefined ? 'timeline-prose' : `timeline-prose ${className}`}
      data-streaming={isStreaming ? 'true' : undefined}
    >
      <Streamdown parseIncompleteMarkdown={isStreaming} plugins={PLUGINS}>
        {text}
      </Streamdown>
    </div>
  )
}
