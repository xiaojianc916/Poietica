import { Prose } from './Prose'

export interface AgentMessageProps {
  readonly text: string
  readonly isStreaming: boolean
}

/** The answer: prose at full measure. */
export function AgentMessage({ text, isStreaming }: AgentMessageProps) {
  return <Prose className="timeline-message" isStreaming={isStreaming} text={text} />
}
