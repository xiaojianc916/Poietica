import './agent-activity-feed.css'

import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useCallback, useLayoutEffect, useRef } from 'react'

import type { FeedRow } from '../../domain/timeline-selectors'

/**
 * 各类条目的首屏估高。
 *
 * 估值只在一行被真正测量之前使用,但它决定了测量那一刻的落差:落差越大,
 * 虚拟器要补偿的滚动增量越大,也就越容易被人眼看见。条目类型是现成的,
 * 用一个常量去估所有类型是白白放弃这份信息。
 *
 * 这些数字是保守的下界:估小了只是补偿一次,估大了会在到达前留白。
 */
const ESTIMATED_ROW_PX: Record<string, number> = {
  userMessage: 72,
  assistantMessage: 240,
  reasoning: 120,
  toolCall: 160,
  plan: 200,
  error: 96,
}

/** 未知类型的兜底估高。 */
const ESTIMATED_FALLBACK_PX = 120

/** 距末端多近算作「仍在看最新一条」。约等于一格滚轮。 */
const BOTTOM_THRESHOLD_PX = 48

/**
 * 视口之外预留的行数。
 *
 * 会话行远高于表格行,预留少了会在快速滚动时露白,多了则白白测量。
 */
const OVERSCAN_ROWS = 6

/**
 * 会话流的滚动区。
 *
 * 一列三段:滚动区装会滚的东西(开场白与对话),输入框是它的兄弟而不是粘在
 * 里面的孩子,浮层绝对定位在框架上、不随滚动移动。
 *
 * 滚动位置只有一个所有者:虚拟器。末端锚定、追随新消息、贴底阈值,以及流式
 * 输出时最后一行长高的增量补偿,都由 anchorTo 这套原语承担 —— 这正是它们
 * 存在的理由,不该在产品代码里复刻。浏览器原生的滚动锚定因此在样式里显式
 * 关闭:两个纠正者对同一次尺寸变化各补偿一次,位移就会翻倍。
 *
 * 本组件不做任何几何计算。唯一的量是画布相对滚动区的偏移,它由 offsetTop
 * 一次读出并存在 ref 里:这个值是虚拟器全部偏移的基准,让它进 state,开场白
 * 那段 flex-grow 动画的每一帧都会重渲染整条对话并挪动基准本身。
 *
 * 它不认识条目类型 —— 除了估高。条目从渲染插槽进来,所以思考链与工具卡片的
 * 演化不触碰滚动。
 */

/**
 * 浮层可以向滚动区要什么。
 *
 * 行号,不是像素。浮层永远不该自己去量一行在哪。
 */
export interface FeedPort {
  /** 滚动区里最靠上的那一行。 */
  readonly activeRow: number
  readonly scrollToRow: (index: number) => void
}

export interface AgentActivityFeedProps {
  readonly rows: readonly FeedRow[]
  readonly renderRow: (row: FeedRow) => ReactNode
  readonly isBusy: boolean
  /** 在对话之上,并且跟着一起滚走。 */
  readonly header?: ReactNode
  /**
   * 画布之后、滚动区之内。
   *
   * 用于属于这一轮而不属于其中某一条的东西,例如等待。缺席就是缺席:
   * undefined,不是 null。
   */
  readonly footer?: ReactNode
  /**
   * 滚动区之下、之外:输入框。
   *
   * 兄弟,不是粘住的孩子。背后没有东西经过,所以对话可以用遮罩化开而不是
   * 被一块颜色盖住。
   */
  readonly dock?: ReactNode
  /** 画在滚动区之上,位于一切会滚的东西之外。 */
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
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)

  /*
   * 画布不是滚动区的第一个孩子:开场白在它上面。这段偏移必须告诉虚拟器,
   * 否则它算出来的位置会整体上移一个页眉的高度。
   *
   * 滚动区是画布的 offsetParent(样式里的 position: relative),所以这就是
   * 一次 offsetTop —— 不需要两次 getBoundingClientRect 再减去 scrollTop,
   * 更不需要一个 ResizeObserver 把它写回 state。
   */
  const scrollMarginRef = useRef(0)

  useLayoutEffect(() => {
    scrollMarginRef.current = canvasRef.current?.offsetTop ?? 0
  })

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => {
      const type = rows[index]?.item.type

      return type === undefined
        ? ESTIMATED_FALLBACK_PX
        : (ESTIMATED_ROW_PX[type] ?? ESTIMATED_FALLBACK_PX)
    },
    /*
     * 条目的身份是它的 id,不是它此刻的序号。恢复会话与回填历史都会让每一条
     * 换序号,用序号当身份,锚点会在那之后落到别的条目上。
     */
    getItemKey: (index) => rows[index]?.item.id ?? index,
    scrollMargin: scrollMarginRef.current,
    /* 末端是稳定的那一侧:回填在上方发生,增长在下方发生。 */
    anchorTo: 'end',
    /* 只在用户本来就在看最新一条时跟随;读历史的人不该被拽走。 */
    followOnAppend: true,
    scrollEndThreshold: BOTTOM_THRESHOLD_PX,
    overscan: OVERSCAN_ROWS,
  })

  /* 打开一段对话,看到的应该是最新一条。 */
  useLayoutEffect(() => {
    virtualizer.scrollToEnd()
  }, [virtualizer])

  const scrollToRow = useCallback(
    (index: number) => {
      virtualizer.scrollToIndex(index, { align: 'start' })
    },
    [virtualizer],
  )

  const items = virtualizer.getVirtualItems()
  const scrollMargin = virtualizer.options.scrollMargin

  return (
    <div className="agent-activity-feed" data-scrollbar-track>
      <div className="agent-activity-feed__viewport" ref={viewportRef}>
        {header}

        <div
          aria-busy={isBusy}
          className="agent-activity-feed__canvas"
          ref={canvasRef}
          role="log"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {items.map((item) => {
            const row = rows[item.index]

            if (row === undefined) {
              return null
            }

            return (
              <div
                className="agent-activity-feed__row"
                data-index={item.index}
                data-streaming={row.isStreamingTail ? 'true' : undefined}
                data-type={row.item.type}
                key={item.key}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${String(item.start - scrollMargin)}px)` }}
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
        : overlay({ activeRow: virtualizer.range?.startIndex ?? 0, scrollToRow })}
    </div>
  )
}
