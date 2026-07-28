import './agent-activity-feed.css'

import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import type { FeedRow } from '../../domain/timeline-selectors'

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
    /*
     * 会话流的滚动契约和普通长列表相反：新内容追加在末尾、历史从头部补进来、
     * 流式回答会把最后一行反复撑大。三件事虚拟器都有官方能力，不必手写——
     * anchorTo 把锚点钉在末端（尾行长高按 size delta 修正，历史前插不跳位），
     * followOnAppend 只在用户本来就贴着底时才跟随新消息，读历史时不打扰，
     * scrollEndThreshold 定义「算作贴底」的距离。
     */
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: BOTTOM_THRESHOLD_PX,
    overscan: 4,
    scrollMargin,
  })

  /* 画布的高度就是虚拟器量出来的总高。贴底不在这里：它是锚点的事，不是 effect 的事。 */
  const totalSize = virtualizer.getTotalSize()

  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在挂载时对齐一次——恢复历史会话要从最新一条打开，之后的跟随由 followOnAppend 负责。
  useLayoutEffect(() => {
    if (rows.length > 0) {
      virtualizer.scrollToEnd()
    }
  }, [])

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
