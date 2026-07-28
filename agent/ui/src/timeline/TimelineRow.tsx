import './timeline.css'

import type { FeedRow } from '@poietica/agent-timeline'
import { memo } from 'react'
import { ErrorNotice } from './ErrorNotice'
import { PlanPanel } from './PlanPanel'
import { Prose } from './Prose'
import { ReasoningPanel } from './ReasoningPanel'
import { ToolCallCard } from './ToolCallCard'
import { UserMessage } from './UserMessage'

/**
 * One entry in the activity feed.
 *
 * Dispatch only. The feed owns scrolling and measurement, each renderer owns
 * its own appearance, and this decides nothing except which one applies.
 *
 * Memoised against the row, whose identity the selector holds stable for as
 * long as its entry is untouched: an arriving token then re-renders the tail
 * and nothing above it.
 *
 * Permission requests are drawn by the surface, because answering one needs the
 * session and a row renderer has no business holding it. They are named here
 * all the same, so the dispatch stays exhaustive — a new entry type is a
 * compile error rather than a silently blank row.
 */
export const TimelineRow = memo(function TimelineRow({ row }: { readonly row: FeedRow }) {
  const { item } = row

  switch (item.type) {
    case 'user_message':
      return <UserMessage text={item.text} />

    case 'agent_text':
      return (
        <Prose className="timeline-message" isStreaming={row.isStreamingTail} text={item.text} />
      )

    case 'agent_thought':
      return <ReasoningPanel isStreaming={row.isStreamingTail} text={item.text} />

    case 'tool_call':
      return <ToolCallCard item={item} />

    case 'plan':
      return <PlanPanel entries={item.entries} />

    case 'error':
      return <ErrorNotice message={item.message} />

    case 'permission':
      return null

    default:
      return unhandled(item)
  }
})

/* A new entry type fails to compile here; at runtime, nothing is drawn. */
function unhandled(_item: never): null {
  return null
}
