import { Streamdown } from 'streamdown'

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
      <Streamdown parseIncompleteMarkdown={isStreaming}>{text}</Streamdown>
    </div>
  )
}
