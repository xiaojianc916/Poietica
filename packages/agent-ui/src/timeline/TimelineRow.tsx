import './timeline.css'

import type { FeedRow } from '@poietica/agent-timeline'
import { memo } from 'react'
import { ErrorNotice } from './ErrorNotice'
import { PermissionRequest } from './PermissionRequest'
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
 * 七个条目类型，七个 case，一个分发点。答复一次权限请求要用到会话，而会话由上层
 * 持有 —— 那是一个参数解决的事（onResolvePermission），不是把一个 case 搬去上层
 * 用三元表达式写第二遍的理由。此前正是后者：六个 case 在这里，第七个在 surface
 * 上，这里留着一支永远跑不到的 return null。
 *
 * 一个新的条目类型在这里是编译错误，不是一行静默的空白。
 */
export interface TimelineRowProps {
  readonly row: FeedRow
  /** 答复一次权限请求。引用必须稳定：这一层是 memo 的。 */
  readonly onResolvePermission: (requestId: string, optionId: string) => void
}

export const TimelineRow = memo(function TimelineRow({
  onResolvePermission,
  row,
}: TimelineRowProps) {
  const { item } = row

  switch (item.type) {
    case 'user_message':
      return <UserMessage images={item.images} text={item.text} />

    case 'agent_text':
      return (
        <Prose className="timeline-message" isStreaming={row.isStreamingTail} text={item.text} />
      )

    case 'agent_thought':
      return <ReasoningPanel isStreaming={row.isStreamingTail} text={item.text} />

    case 'tool_call':
      return <ToolCallCard isInFlight={row.isInFlight} item={item} />

    case 'plan':
      return <PlanPanel entries={item.entries} />

    case 'error':
      return <ErrorNotice message={item.message} />

    case 'permission':
      return <PermissionRequest item={item} onResolve={onResolvePermission} />

    default:
      return unhandled(item)
  }
})

/* A new entry type fails to compile here; at runtime, nothing is drawn. */
function unhandled(_item: never): null {
  return null
}
