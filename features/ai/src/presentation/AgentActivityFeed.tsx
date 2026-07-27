import './agent-activity-feed.css'

import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useCallback, useEffect, useRef } from 'react'

import type { FeedRow } from '../domain/timeline-selectors'

/**
 * The scroller of the assistant surface.
 *
 * Two layers, and the split is the point: the scrollport holds everything that
 * scrolls — the masthead, the virtualised transcript, the composer as a sticky
 * band at the end of the flow — and the frame around it holds what is painted
 * over the scrollport without moving with it. That is how an editor mounts its
 * minimap, and the only way an overlay can stay put without a sticky offset or
 * a negative margin compensating for the scroll.
 *
 * It knows nothing about entry types: entries arrive through a render slot, so
 * reasoning chains and tool-call cards evolve without touching scrolling.
 *
 * Stick-to-bottom is intent-driven, not position-driven. Once the user has
 * scrolled up they are reading history, and a streaming run must never yank
 * them back.
 */

const BOTTOM_THRESHOLD_PX = 48
const ESTIMATED_ROW_PX = 96

/**
 * What an overlay may ask of the scrollport.
 *
 * Rows, not pixels. Both values come from the virtualiser, which is the only
 * thing that knows where a row sits — under virtualisation the rows outside
 * the viewport have no box to measure, so an overlay must never try.
 */
export interface FeedPort {
  /** The first row of the scrollport, overscan excluded. */
  readonly activeRow: number
  readonly scrollToRow: (index: number) => void
}

export interface AgentActivityFeedProps {
  readonly rows: readonly FeedRow[]
  readonly renderRow: (row: FeedRow) => ReactNode
  readonly isBusy: boolean
  /** Above the transcript, and scrolling away with it. */
  readonly header?: ReactNode
  /**
   * Rendered after the virtualised canvas, inside the scrollport.
   *
   * For what is true of the run rather than of an entry in it — a wait, for
   * instance. Outside the canvas it is never measured as a row, so it cannot
   * disturb the virtualiser.
   */
  readonly footer?: ReactNode
  /** The band that sticks to the bottom of the scrollport: the composer. */
  readonly dock?: ReactNode
  /** Painted over the scrollport, outside everything that scrolls. */
  readonly overlay?: (port: FeedPort) => ReactNode
}

export function AgentActivityFeed({
  rows,
  renderRow,
  isBusy,
  header,
  footer,
  dock,
  overlay,
}: AgentActivityFeedProps) {
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

  /*
   * The tail grows while its id stays the same, so following the identity of
   * the last row leaves a streaming answer scrolling out of view. The measured
   * total is the only value that changes with the content itself.
   */
  const totalSize = virtualizer.getTotalSize()

  /*
   * The end of the scroll range, not the end of the last row.
   *
   * Aligning a row to the end of the scrollport would park it under the dock,
   * which occupies that edge. The bottom of the range already accounts for the
   * dock, because the dock is part of the flow; the browser clamps the value,
   * so nothing here has to.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: rows.length 与 totalSize 是这个 effect 的触发源，而不是它读取的值——贴底只读 ref，删掉依赖流式回答就会滚出视野。
  useEffect(() => {
    const element = scrollRef.current
    if (element === null || !pinnedRef.current) {
      return
    }
    element.scrollTop = element.scrollHeight
  }, [rows.length, totalSize])

  const virtualRows = virtualizer.getVirtualItems()

  return (
    <div className="agent-activity-feed">
      <div className="agent-activity-feed__viewport" onScroll={handleScroll} ref={scrollRef}>
        {header}

        <div
          aria-busy={isBusy}
          className="agent-activity-feed__canvas"
          role="log"
          style={{ height: totalSize }}
        >
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

        {dock === undefined ? null : <div className="agent-activity-feed__dock">{dock}</div>}
      </div>

      {overlay === undefined
        ? null
        : overlay({
            activeRow: virtualizer.range?.startIndex ?? 0,
            scrollToRow: (index) => {
              virtualizer.scrollToIndex(index, { align: 'start' })
            },
          })}
    </div>
  )
}
