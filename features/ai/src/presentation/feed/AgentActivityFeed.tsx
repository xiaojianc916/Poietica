import './agent-activity-feed.css'

import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { FeedRow } from '../../domain/timeline-selectors'
import { useStickToBottom } from './use-stick-to-bottom'

/**
 * The scroller of the assistant surface.
 *
 * 一列三段,而三段各自独立正是要点:滚动区只装会滚的东西(开场白与虚拟化的
 * 对话),输入框是它的兄弟而不是它里面粘住的孩子,浮层则绝对定位在框架上、不
 * 随滚动移动 —— 编辑器挂缩略图就是这个结构。
 *
 * 输入框为什么必须在外面:滚动区的下沿是用遮罩化开的,而遮罩作用于整个盒子,
 * 输入框留在里面就会跟着一起被抹淡。搬到外面之后,下沿不需要涂任何颜色。
 *
 * 框架上的 data-scrollbar-track 是给自绘滚动条的:滚动的只是上面那段,但滑块
 * 按整块面板的高度来画,所以它不会在输入框上沿断掉。
 *
 * It knows nothing about entry types: entries arrive through a render slot, so
 * reasoning chains and tool-call cards evolve without touching scrolling.
 */

const BOTTOM_THRESHOLD_PX = 48
const ESTIMATED_ROW_PX = 96

/**
 * What an overlay may ask of the scrollport.
 *
 * Rows, not pixels. Both values come from the virtualiser, which is the only
 * thing that knows where a row sits — under virtualisation the rows outside the
 * viewport have no box to measure, so an overlay must never try.
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
   * disturb the virtualiser. Absent means absent: undefined, not null.
   */
  readonly footer?: ReactNode
  /**
   * Under the scrollport and outside it: the composer.
   *
   * A sibling, not a sticky child. Nothing scrolls behind it, so the transcript
   * can dissolve into the panel with a mask instead of being covered by paint.
   */
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
  const canvasRef = useRef<HTMLDivElement | null>(null)

  /*
   * The transcript does not begin at the top of the scrollport: the masthead is
   * in the flow above it, and it collapses as the conversation starts. Every
   * position the virtualiser reports is measured from the scrollport, so
   * without that offset each row is placed — and each jump from the rail lands
   * — one masthead too far. It is measured from the boxes rather than taken
   * from offsetTop, which answers to whichever ancestor happens to be
   * positioned.
   */
  const [scrollMargin, setScrollMargin] = useState(0)

  useLayoutEffect(() => {
    const canvas = canvasRef.current

    if (canvas === null) {
      return undefined
    }

    const measure = () => {
      const viewport = scrollRef.current

      if (viewport !== null) {
        setScrollMargin(
          canvas.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top +
            viewport.scrollTop,
        )
      }
    }

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(canvas)

    const above = canvas.previousElementSibling

    if (above !== null) {
      observer.observe(above)
    }

    return () => {
      observer.disconnect()
    }
  }, [])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_PX,
    getItemKey: (index) => rows[index]?.item.id ?? index,
    overscan: 4,
    scrollMargin,
  })

  /*
   * The tail grows while its id stays the same, so following the identity of
   * the last row leaves a streaming answer scrolling out of view. The measured
   * total is the only value that changes with the content itself.
   */
  const totalSize = virtualizer.getTotalSize()
  const follow = useStickToBottom(scrollRef, BOTTOM_THRESHOLD_PX)

  // biome-ignore lint/correctness/useExhaustiveDependencies: rows.length 与 totalSize 是这个 effect 的触发源，而不是它读取的值——贴底只读 ref，删掉依赖流式回答就会滚出视野。
  useEffect(() => {
    follow()
  }, [follow, rows.length, totalSize])

  return (
    <div className="agent-activity-feed" data-scrollbar-track>
      <div className="agent-activity-feed__viewport" ref={scrollRef}>
        {header}

        <div
          aria-busy={isBusy}
          className="agent-activity-feed__canvas"
          ref={canvasRef}
          role="log"
          style={{ height: totalSize }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]

            if (row === undefined) {
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
                style={{
                  transform: `translateY(${String(virtualRow.start - scrollMargin)}px)`,
                }}
              >
                {renderRow(row)}
              </div>
            )
          })}
        </div>

        {footer === undefined ? null : <div className="agent-activity-feed__footer">{footer}</div>}
      </div>

      {dock === undefined ? null : <div className="agent-activity-feed__dock">{dock}</div>}

      {overlay === undefined
        ? null
        : overlay({
            /*
             * The end of the scroll range, not the end of the last row:
             * aligning to the end of the scrollport would park a turn under the
             * dock, which occupies that edge. The browser clamps the value.
             */
            activeRow: virtualizer.range?.startIndex ?? 0,
            scrollToRow: (index) => {
              virtualizer.scrollToIndex(index, { align: 'start' })
            },
          })}
    </div>
  )
}
