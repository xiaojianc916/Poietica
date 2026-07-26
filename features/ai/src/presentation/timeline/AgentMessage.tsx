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
const STREAMDOWN_PLUGINS = { cjk, code }

export interface AgentMessageProps {
  readonly text: string
  readonly isStreaming: boolean
}

/**
 * The answer.
 *
 * While a message is still arriving its markdown is, by definition, half
 * written. Streamdown is told so, and closes the open constructs itself rather
 * than letting a lone fence swallow the rest of the reply.
 */
export function AgentMessage({ text, isStreaming }: AgentMessageProps) {
  return (
    <div className="timeline-message" data-streaming={isStreaming ? 'true' : undefined}>
      <Streamdown parseIncompleteMarkdown={isStreaming} plugins={STREAMDOWN_PLUGINS}>
        {text}
      </Streamdown>
    </div>
  )
}
