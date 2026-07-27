import './timeline.css'

import type { FeedRow } from '../../domain/timeline-selectors'
import { AgentMessage } from './AgentMessage'
import { ErrorNotice } from './ErrorNotice'
import { PlanPanel } from './PlanPanel'
import { ReasoningPanel } from './ReasoningPanel'
import { ToolCallCard } from './ToolCallCard'
import { UserMessage } from './UserMessage'

/**
 * One entry in the activity feed.
 *
 * Dispatch only. The feed owns scrolling and measurement, each renderer owns
 * its own appearance, and this decides nothing except which one applies.
 *
 * Permission requests are deliberately absent: answering one needs the session,
 * and a row renderer has no business holding it. The surface draws them.
 */
export function TimelineRow({ row }: { readonly row: FeedRow }) {
  const { item } = row

  switch (item.type) {
    case 'user_message':
      return <UserMessage text={item.text} />

    case 'agent_text':
      return <AgentMessage isStreaming={row.isStreamingTail} text={item.text} />

    case 'agent_thought':
      return <ReasoningPanel isStreaming={row.isStreamingTail} text={item.text} />

    case 'tool_call':
      return <ToolCallCard item={item} />

    case 'plan':
      return <PlanPanel entries={item.entries} />

    case 'error':
      return <ErrorNotice message={item.message} />

    default:
      return null
  }
}
