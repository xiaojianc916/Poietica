import './conversation-minimap.css'

import type { ConversationTurn } from '@poietica/agent-timeline'
import { type CSSProperties, memo, useCallback } from 'react'
import { railCapacity, useRailBudget } from './rail-budget'
import { groupTurns, type RailRange, thumbSpan } from './rail-groups'
import { turnIndexAtRow } from './turn-index'
import { useFisheye } from './use-fisheye'

/* poietica:conversation-minimap-density@v20 */

/**
 * The turn rail: the table of contents of the conversation, on the edge.
 *
 * One bar per turn while they fit; once they do not, one bar per run of turns.
 * It reads a row index and reports a row index — the scrollport owns the
 * scrolling, and this owns nothing but the pointing.
 *
 * 为什么要并格,而不是让轨道自己滚动:一个需要自己滚动的导航条已经不是导航条
 * 了,它把"看见全局"这唯一的用途还给了被导航的东西。像素预算有限而轮次无界,
 * 只能压缩表示,不能延长画布。
 *
 * Native buttons in a nav, so keyboard order, focus and activation come from
 * the platform; the bars are spans because a bar is paint, not a target.
 */
export interface ConversationMinimapProps {
  readonly turns: readonly ConversationTurn[]
  /** 人正在读的那一行;跳转期间是人要求看的那一行。 */
  readonly activeRow: number
  readonly onSelect: (rowIndex: number) => void
  /**
   * 视口此刻覆盖到哪一段,没有量到几何时缺席。
   *
   * 高亮回答"人在读哪一轮",游标回答"人看得见多长" —— 长会话里后者是前者答不了
   * 的:一格代表八轮的时候,亮着的那一格并不说明屏幕上装下了多少。
   */
  readonly visibleRows?: RailRange | null
}

function Rail({ turns, activeRow, onSelect, visibleRows }: ConversationMinimapProps) {
  const fisheye = useFisheye()
  const { ref: measure, available } = useRailBudget()

  /*
   * 两个 ref 落在同一个节点上:一个要指针,一个要尺寸。
   *
   * 两者都返回清理函数,合并之后也必须返回一个 —— React 19 在卸载时调用它。
   * 依赖都是引用稳定的(useCallback 空依赖),所以这个回调不会每帧换身份,
   * 节点也就不会每帧被反复解绑重绑。
   */
  const setRail = useCallback(
    (node: HTMLElement | null) => {
      const detachFisheye = fisheye(node)
      const detachMeasure = measure(node)

      return () => {
        detachFisheye?.()
        detachMeasure?.()
      }
    },
    [fisheye, measure],
  )

  /*
   * 先算装得下几格,再决定一格代表几轮。
   *
   * 不包 useMemo,理由和下面的二分一样:这是一次 O(N) 的遍历,N 是屏幕上放得
   * 下的格子数量级,而这个组件被 memo 包着、滚动帧里根本不重渲染。
   */
  const items = groupTurns(turns, railCapacity(available))

  /*
   * 有序数组上求"最后一个不晚于当前行的一格",这是二分。
   *
   * 并格没有破坏前提:桶首的 rowIndex 仍然严格递增,所以二分照旧成立,答案从
   * "第几轮"变成"第几格",而那正是要高亮的东西。
   */
  const active = turnIndexAtRow(items, activeRow)

  /*
   * 游标的几何是两个序号,不是两个像素。
   *
   * 位置与长度都是行距的整数倍,所以交给 calc 去乘 —— 样式表仍然是唯一
   * 写下尺寸的地方,这里只说"第几格起、几格长"。脚本一旦开始算像素,
   * 静息几何就不再读得出来了。
   */
  const thumb = thumbSpan(items, visibleRows ?? null)

  const thumbStyle =
    thumb === null
      ? undefined
      : ({
          '--cp-thumb-from': String(thumb.from),
          '--cp-thumb-span': String(thumb.span),
        } as CSSProperties)

  return (
    <nav aria-label="会话轮次" className="conversation-minimap" ref={setRail}>
      {/*
       * 视口游标,画在条的下面。
       *
       * aria-hidden:它说的事 aria-current 已经说过了,而读屏用户拿不到"看得见
       * 多长"这种视觉量 —— 报出来只是多念一遍。
       */}
      {thumb === null ? null : (
        <span aria-hidden="true" className="conversation-minimap__thumb" style={thumbStyle} />
      )}

      {items.map((item, index) => {
        /*
         * 序数在前,内容在后。
         *
         * 这一条在视觉上是一根短横,它在整根轨道里的位置就是它全部的空间信息;
         * 而读屏用户拿不到这份信息 —— 只报内容,等于让人自己数到第几根。
         *
         * 并格之后更要报区间:一格代表八轮却只报一个序数,是在谎报位置。
         */
        const total = String(turns.length)

        const position =
          item.kind === 'cluster'
            ? `第 ${String(item.from)}–${String(item.to)} 轮，共 ${total} 轮`
            : `第 ${String(item.ordinal)} 轮，共 ${total} 轮`

        const label = `${position}：${item.label}`

        return (
          <button
            /*
             * location,不是 true。WAI-ARIA 把 location 定义为"在环境或上下文中的
             * 当前位置",目录里被高亮的那一项正是它举的例子;true 只说"是当前的",
             * 没说是哪一种当前。样式不再挑 token,只看属性在不在。
             */
            aria-current={index === active ? 'location' : undefined}
            aria-label={label}
            className="conversation-minimap__turn"
            data-cluster={item.kind === 'cluster' ? '' : undefined}
            key={item.id}
            /*
             * 一格一个闭包,就这样。下面的 memo 让这些闭包一年也建不了几次,
             * 为它们做共享处理器 + data-row 往返,是拿真实的复杂度去换一个不
             * 存在的开销。
             */
            onClick={() => {
              onSelect(item.rowIndex)
            }}
            type="button"
          >
            <span className="conversation-minimap__bar" />

            {/*
             * Preview card: a real element because it needs two semantic rows.
             * aria-hidden so screen readers use the button's accessible name
             * (aria-label) rather than reading the card prose twice.
             */}
            <div aria-hidden="true" className="conversation-minimap__card">
              {item.kind === 'cluster' && (
                <p className="conversation-minimap__card-kicker">
                  {`${String(item.to - item.from + 1)} 项`}
                </p>
              )}
              <p className="conversation-minimap__card-question">{item.label}</p>
              {item.reply !== undefined && (
                <p className="conversation-minimap__card-reply">{item.reply}</p>
              )}
            </div>
          </button>
        )
      })}
    </nav>
  )
}

/**
 * 滚动帧里整棵跳过。
 *
 * 滚动区每一帧都重渲染 —— 虚拟器必须如此 —— 于是浮层每帧被调用一次,产出一个新
 * 元素,React 就得逐个比对 N 个按钮和 N 张卡片。但这三个入参在构造上就是引用稳定
 * 的:turns 走时间线的弱表缓存,activeRow 是数字且跨行才变,onSelect 是上游一个空
 * 依赖的 useCallback。所以浅比较几乎总是命中。
 *
 * 并格让被比对的元素数量有了上限:即便浅比较落空,代价也不再随会话长度增长。
 */
export const ConversationMinimap = memo(Rail)
