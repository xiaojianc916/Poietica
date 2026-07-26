import './agent-activity-feed.css'

import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useCallback, useEffect, useRef } from 'react'

import type { FeedRow } from '../domain/timeline-selectors'

/**
 * The agent activity feed.
 *
 * One flat, ordered, virtualised column. It knows nothing about entry types:
 * entries are supplied through a render slot, so reasoning chains and tool-call
 * cards can evolve without touching scrolling or measurement.
 *
 * Stick-to-bottom is intent-driven, not position-driven. Once the user scrolls
 * up they are reading history, and a streaming run must never yank them back.
 */

const BOTTOM_THRESHOLD_PX = 48
const ESTIMATED_ROW_PX = 96

export interface AgentActivityFeedProps {
  readonly rows: readonly FeedRow[]
  readonly renderRow: (row: FeedRow) => ReactNode
  readonly isBusy: boolean
  /**
   * Rendered after the virtualised canvas, inside the same scroller.
   *
   * For what is true of the run rather than of an entry in it — a wait, for
   * instance. Outside the canvas it is never measured as a row, so it cannot
   * disturb the virtualiser.
   */
  readonly footer?: ReactNode
}

export function AgentActivityFeed({ rows, renderRow, isBusy, footer }: AgentActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_PX,
    getItemKey: (index) => rows[index]?.item.id ?? index,
    overscan: 8,
  })

  const handleScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    pinnedRef.current = distance <= BOTTOM_THRESHOLD_PX
  }, [])

  const tailKey = rows.at(-1)?.item.id ?? ''

  useEffect(() => {
    if (!pinnedRef.current || rows.length === 0) {
      return
    }
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
  }, [rows.length, tailKey, virtualizer])

  const virtualRows = virtualizer.getVirtualItems()

  return (
    <div
      aria-busy={isBusy}
      className="agent-activity-feed"
      onScroll={handleScroll}
      ref={scrollRef}
      role="log"
    >
      <div className="agent-activity-feed__canvas" style={{ height: virtualizer.getTotalSize() }}>
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index]
          if (!row) {
            return null
          }

          return (
            <div
              className="agent-activity-feed__row"
              data-index={virtualRow.index}
              data-streaming={row.isStreamingTail ? 'true' : undefined}
              data-type={row.item.type}
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${String(virtualRow.start)}px)` }}
            >
              {renderRow(row)}
            </div>
          )
        })}
      </div>

      {footer === null || footer === undefined ? null : (
        <div className="agent-activity-feed__footer">{footer}</div>
      )}
    </div>
  )
}
