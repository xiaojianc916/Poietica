import { useEffect, useRef, useState } from 'react'

import { AgentDisclosure } from './AgentDisclosure'
import { AgentMarkdown } from './AgentMarkdown'

/*
 * Opens while the model is thinking and closes shortly after it stops, once.
 * The user always wins: an explicit toggle disables the automatic behaviour.
 */

const AUTO_CLOSE_DELAY_MS = 1000

export type ReasoningPanelProps = {
  children: string
  durationSeconds?: number
  isStreaming?: boolean
}

export const ReasoningPanel = ({
  children,
  durationSeconds,
  isStreaming = false,
}: ReasoningPanelProps) => {
  const [open, setOpen] = useState(isStreaming)
  const userDecidedRef = useRef(false)

  useEffect(() => {
    if (userDecidedRef.current) {
      return undefined
    }

    if (isStreaming) {
      setOpen(true)
      return undefined
    }

    const timer = setTimeout(() => {
      setOpen(false)
    }, AUTO_CLOSE_DELAY_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [isStreaming])

  const summary = isStreaming
    ? 'Thinking'
    : durationSeconds === undefined
      ? 'Thought for a moment'
      : `Thought for ${String(durationSeconds)}s`

  return (
    <AgentDisclosure
      onOpenChange={(next) => {
        userDecidedRef.current = true
        setOpen(next)
      }}
      open={open}
      summary={<span className="agent-reasoning__summary">{summary}</span>}
      tone={isStreaming ? 'running' : 'default'}
    >
      <div className="agent-reasoning__body">
        <AgentMarkdown isStreaming={isStreaming}>{children}</AgentMarkdown>
      </div>
    </AgentDisclosure>
  )
}
