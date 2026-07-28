import './conversation-minimap.css'

import type { ConversationTurn } from '@poietica/agent-timeline'
import { useFisheye } from './use-fisheye'

/**
 * The turn rail: the table of contents of the conversation, on the edge.
 *
 * One bar per turn, in order. It reads a row index and reports a row index —
 * the scrollport owns the scrolling, and this owns nothing but the pointing.
 *
 * Native buttons in a nav, so keyboard order, focus and activation come from
 * the platform; the bars are spans because a bar is paint, not a target.
 */
export interface ConversationMinimapProps {
  readonly turns: readonly ConversationTurn[]
  /** The row at the top of the scrollport. */
  readonly activeRow: number
  readonly onSelect: (rowIndex: number) => void
}

/**
 * The turn being read: the last one that has started above the fold.
 *
 * Turns are ordered by construction, so the answer is the last turn whose
 * first row is at or above the top of the scrollport.
 */
function activeIndexOf(turns: readonly ConversationTurn[], activeRow: number): number {
  let active = 0

  turns.forEach((turn, index) => {
    if (turn.rowIndex <= activeRow) {
      active = index
    }
  })

  return active
}

export function ConversationMinimap({ turns, activeRow, onSelect }: ConversationMinimapProps) {
  const fisheye = useFisheye()
  const active = activeIndexOf(turns, activeRow)

  return (
    <nav aria-label="会话轮次" className="conversation-minimap" ref={fisheye}>
      {turns.map((turn, index) => (
        <button
          aria-current={index === active ? 'true' : undefined}
          aria-label={turn.label}
          className="conversation-minimap__turn"
          data-label={turn.label}
          key={turn.id}
          onClick={() => {
            onSelect(turn.rowIndex)
          }}
          type="button"
        >
          <span className="conversation-minimap__bar" />
        </button>
      ))}
    </nav>
  )
}
