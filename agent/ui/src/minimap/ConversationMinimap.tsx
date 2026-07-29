import './conversation-minimap.css'

import type { ConversationTurn } from '@poietica/agent-timeline'
import { memo } from 'react'
import { turnIndexAtRow } from './turn-index'
import { useFisheye } from './use-fisheye'

/* poietica:conversation-minimap-escape@v16 */

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
   * 有序数组上求"最后一个不晚于当前行的轮次",这是二分。
   *
   * 不包 useMemo。轮次至多几十个,一次二分是个位数次比较,而 useMemo 自己要分配
   * 依赖数组并逐项比较 —— 在一个已经 memo、很少重渲染的组件里,包装比被包装的
   * 东西还贵。为省不掉的开销加缓存,是另一种不专业。
   */
  const active = turnIndexAtRow(turns, activeRow)

  return (
    <nav aria-label="会话轮次" className="conversation-minimap" ref={fisheye}>
      {turns.map((turn, index) => {
        /*
         * 序数在前,内容在后。
         *
         * 这一条在视觉上是一根短横,它在整根轨道里的位置就是它全部的空间信息;
         * 而读屏用户拿不到这份信息 —— 只报内容,等于让人自己数到第几根。目录类
         * 控件播报序数是通行做法,代价是一次字符串拼接。
         *
         * 拆成两段不是为了好看:CJK 在宽度计算上按双宽算,一行写完会顶到格式化
         * 上限;拆开之后"第几轮/共几轮"与"它是什么"各自成句,也更好读。
         */
        const position = `第 ${String(index + 1)} 轮，共 ${String(turns.length)} 轮`
        const label = `${position}：${turn.label}`

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
            key={turn.id}
            /*
             * 一格一个闭包,就这样。
             *
             * 曾经改成"一个共享处理器 + data-row + Number() + 整数守卫",为的是
             * 避免每次渲染重建 N 个闭包。下面的 memo 把那个前提消灭了:滚动帧里
             * 这个组件根本不重渲染,闭包一年也建不了几次。留着那套就是拿一个 DOM
             * 属性、一次字符串往返和一个只可能因自己写错才触发的分支,去换一个
             * 不存在的开销。
             */
            onClick={() => {
              onSelect(turn.rowIndex)
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
              <p className="conversation-minimap__card-question">{turn.label}</p>
              {turn.reply !== undefined && (
                <p className="conversation-minimap__card-reply">{turn.reply}</p>
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
 * 它不是万能的:流式输出时上游每帧重建 turns 数组,那时照旧全量比对。不过 reply
 * 截断在 300 字符,所以答案超过 300 字之后每个 turn 的内容其实不再变化 —— 让
 * 选择器复用未变的 turn 对象就能把这段也覆盖掉,那是 agent/timeline 包里的一次
 * 独立改动,不在这一版。
 */
export const ConversationMinimap = memo(Rail)
