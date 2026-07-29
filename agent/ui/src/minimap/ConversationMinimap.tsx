import './conversation-minimap.css'

import type { ConversationTurn } from '@poietica/agent-timeline'
import { type MouseEvent, memo, useCallback, useMemo } from 'react'
import { turnIndexAtRow } from './turn-index'
import { useFisheye } from './use-fisheye'

/* poietica:conversation-minimap-perf@v14 */

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
  /** 人正在读的那一行;跳转期间是人要求看的那一行。 */
  readonly activeRow: number
  readonly onSelect: (rowIndex: number) => void
}

function Rail({ turns, activeRow, onSelect }: ConversationMinimapProps) {
  const fisheye = useFisheye()

  /*
   * 有序数组上求"最后一个不晚于当前行的轮次",这是二分。原先是一次不提前
   * 退出的 forEach 全扫,而且每次渲染都跑 —— 滚动引起的渲染频繁,答案却只在
   * 跨越轮次边界时才变。
   */
  const active = useMemo(() => turnIndexAtRow(turns, activeRow), [turns, activeRow])

  /*
   * 一个处理器,不是每格一个。
   *
   * 每格一个闭包,轮次有多少就重建多少,而它们做的是同一件事、只差一个数;
   * 那个数写在格子上,从 currentTarget 读回来就行 —— 于是这个函数与轮次数量
   * 无关,也跨渲染稳定。
   *
   * 它挂在 button 上,而不是挂在 nav 上做委托。委托同样能省下闭包,但那把点击
   * 语义放到了一个非交互元素上:键盘能用只是因为 button 的 Enter 会派发 click
   * 并冒泡上去 —— 那是巧合带来的正确,不是结构带来的正确。放在 button 上,
   * 焦点、Enter、Space、辅助技术的激活语义全部由平台给,一行都不用写。
   *
   * dataset 是索引签名,所以是方括号:tsconfig 里 noPropertyAccessFromIndexSignature
   * 开着,点号访问会被 tsc 拦下 —— 它拦的是"看起来像已知属性、实际是任意键"。
   */
  const handleSelect = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const rowIndex = Number(event.currentTarget.dataset['row'])

      /* 属性缺失时 Number(undefined) 是 NaN,而 NaN 不是整数。 */
      if (!Number.isInteger(rowIndex)) {
        return
      }

      onSelect(rowIndex)
    },
    [onSelect],
  )

  return (
    <nav aria-label="会话轮次" className="conversation-minimap" ref={fisheye}>
      {turns.map((turn, index) => (
        <button
          /*
           * location,不是 true。WAI-ARIA 把 location 定义为"在环境或上下文
           * 中的当前位置",目录里被高亮的那一项正是它举的例子;true 只说
           * "是当前的",没说是哪一种当前。样式不再挑 token,只看属性在不在。
           */
          aria-current={index === active ? 'location' : undefined}
          /*
           * 序数在前,内容在后。
           *
           * 这一条在视觉上是一根短横,它在整根轨道里的位置就是它全部的空间
           * 信息;而读屏用户拿不到这份信息 —— 只报内容,等于让人自己数到第几
           * 根。目录类控件播报序数是通行做法,代价是一次字符串拼接。
           */
          aria-label={`第 ${String(index + 1)} 轮，共 ${String(turns.length)} 轮：${turn.label}`}
          className="conversation-minimap__turn"
          data-row={turn.rowIndex}
          key={turn.id}
          onClick={handleSelect}
          type="button"
        >
          <span className="conversation-minimap__bar" />

          {/*
           * Preview card: a real element because it needs two semantic rows.
           * aria-hidden so screen readers use the button's accessible name
           * (aria-label) rather than reading the card prose twice.
           */}
          <div aria-hidden="true" className="conversation-minimap__card">
            <p className="conversation-minimap__card-question">{turn.label}</p>
            {turn.reply !== undefined && (
              <p className="conversation-minimap__card-reply">{turn.reply}</p>
            )}
          </div>
        </button>
      ))}
    </nav>
  )
}

/**
 * 滚动帧里整棵跳过。
 *
 * 滚动区每一帧都重渲染 —— 虚拟器必须如此 —— 于是浮层每帧被调用一次,产出一个
 * 新元素,React 就得逐个比对 N 个按钮和 N 张卡片。但这三个入参在构造上就是
 * 引用稳定的:turns 走时间线的 WeakMap 缓存,activeRow 是数字且跨行才变,
 * onSelect 是上游一个空依赖的 useCallback。所以浅比较几乎总是命中。
 *
 * 它不是万能的:流式输出时 turns 每段都重建,那时照旧全量比对。但那正好是鱼眼
 * 没在跑的时候 —— 两笔开销不会叠在同一帧上。
 */
export const ConversationMinimap = memo(Rail)
