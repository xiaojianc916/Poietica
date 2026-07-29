import './agent-activity-feed.css'

import type { FeedRow } from '@poietica/agent-timeline'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { type RowSpan, rowAtAnchor } from './reading-position'
import { useRevealIntent } from './use-reveal-intent'

/* poietica:conversation-minimap-audit@v15 */

/**
 * 各类条目的首屏估高。
 *
 * 估值只在一行被真正测量之前使用,但它决定了测量那一刻的落差:落差越大,虚拟器
 * 要补偿的滚动增量越大,也就越容易被人眼看见。条目类型是现成的,用一个常量去估
 * 所有类型是白白放弃这份信息。
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
 * 距顶端多远就去读更早的一段。
 *
 * 比一屏还早。等滚到顶再去读,人一定会撞上一段等待 —— 那就是"突兀"的全部来源。
 * 提前一屏发起,读回来时它落在视口之上,人只是继续往上滚,看不到任何边界,也没有
 * 任何东西需要他去点。
 */
const PREFETCH_START_PX = 800

/**
 * 视口之外预留的行数。
 *
 * 会话行远高于表格行,预留少了会在快速滚动时露白,多了则白白测量。
 */
const OVERSCAN_ROWS = 6

/**
 * 视线在视口里的位置,自上而下的比例。
 *
 * 高亮问的是"人在读哪一轮",而不是"哪一行碰到了视口上沿"。上沿是一条边,上一轮
 * 的残留一个像素就会占住它;三分之一处是人真正在看的地方,越界时机因此与阅读
 * 感知一致,而不与像素巧合一致。
 */
const READING_ANCHOR_RATIO = 1 / 3

/**
 * 会话流的滚动区。
 *
 * 一列三段:滚动区装会滚的东西(开场白与对话),输入框是它的兄弟而不是粘在里面的
 * 孩子,浮层绝对定位在框架上、不随滚动移动。
 *
 * 滚动位置只有一个所有者:虚拟器。末端锚定、追随新消息、贴底阈值,以及流式输出时
 * 最后一行长高的增量补偿,都由 anchorTo 这套原语承担 —— 这正是它们存在的理由,
 * 不该在产品代码里复刻。浏览器原生的滚动锚定因此在样式里显式关闭:两个纠正者对
 * 同一次尺寸变化各补偿一次,位移就会翻倍。
 *
 * 本组件不做任何几何计算 —— 除了四个派生量,而它们共用一次读取:画布相对滚动区
 * 的偏移、人是不是贴在末端、视线落在哪一行、视口顶端是哪一行。四者是同一次布局
 * 的四个侧面,合在一处意味着一次布局只读一次几何,也意味着它们在时间上不会错开。
 *
 * 这次读取挂在两处:滚动事件,以及每一次布局之后。只挂滚动是不够的 —— 流式输出
 * 把行撑高、面板被拖窄、抽屉展开,都会让同一个滚动位置对应到另一行上,而它们都
 * 不产生滚动事件。挂在布局之后同时把面板缩放一并解决了:虚拟器本来就观察滚动
 * 容器的尺寸并在变化时重渲染,所以这里不需要第二个观察者。
 *
 * 它不认识条目类型 —— 除了估高。条目从渲染插槽进来,所以思考链与工具卡片的演化
 * 不触碰滚动。
 */

/**
 * 浮层可以向滚动区要什么。
 *
 * 行号,不是像素。浮层永远不该自己去量一行在哪。
 */
export interface FeedPort {
  /** 人正在读的那一行;跳转期间是人要求看的那一行。 */
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
   * 用于属于这一轮而不属于其中某一条的东西,例如等待。缺席就是缺席:undefined,
   * 不是 null。
   */
  readonly footer?: ReactNode
  /**
   * 滚动区之下、之外:输入框。
   *
   * 兄弟,不是粘住的孩子。背后没有东西经过,所以对话可以用遮罩化开而不是被一块
   * 颜色盖住。
   */
  readonly dock?: ReactNode
  /**
   * 人读到了内容的上边界。
   *
   * 滚动区只报告位置:它不知道上面还有没有东西,也不知道该去读什么 —— 那是数据
   * 的事。它会被反复报告,所以约定由实现方保证幂等。
   */
  readonly onReachStart?: (() => void) | undefined
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
  onReachStart,
  overlay,
}: AgentActivityFeedProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)

  /*
   * 画布相对滚动区的偏移:开场白在画布上面,这段距离必须告诉虚拟器,否则它算出
   * 来的位置会整体上移一个页眉的高度。
   *
   * 它是 state 而不是 ref。曾经是 ref,理由写的是"进 state 会让开场那段 flex-grow
   * 动画每一帧都重渲染整条对话" —— 这个理由两层都不成立:那段动画在 feed 根的
   * ::before / ::after 上,移动的是滚动区整体,而这里量的是画布相对滚动区的偏移,
   * 不受它影响;何况 CSS 过渡期间根本不产生 React 渲染。
   *
   * 而 ref 的代价是实打实的:改 ref 不触发重渲染,虚拟器在渲染期读到的 scrollMargin
   * 会一直停在首帧的 0,挂载时的 scrollToEnd 正好落在那之前 —— 初次打开必定差一个
   * 画布偏移。
   *
   * 滚动区是画布的 offsetParent(样式里的 position: relative),所以这是一次
   * offsetTop,不需要两次 getBoundingClientRect 再减去 scrollTop。
   */
  const [scrollMargin, setScrollMargin] = useState(0)

  /*
   * 人此刻是不是贴在末端。
   *
   * 这是决定锚点归属的两个事实之一,而它是纯几何的 —— 所以直接问滚动区,不引第二
   * 个位置来源,也不写 scrollTop。初值为真:打开一段对话看到的就是最新一条。
   */
  const [isPinnedToEnd, setIsPinnedToEnd] = useState(true)

  /*
   * 视线落在哪一行。
   *
   * null 是"还没读到过",不是"第 0 行"。首帧的布局效应会把视口送到末尾,那一帧
   * 还没有任何几何可读,若此时谎称 0,缩略导航会先高亮第一轮再跳到最后一轮 ——
   * 开场那一下闪跳就是这么来的。
   */
  const [readingRow, setReadingRow] = useState<number | null>(null)

  const {
    pending,
    begin: beginReveal,
    settle: settleReveal,
    watch: watchReveal,
  } = useRevealIntent()

  /*
   * 虚拟器此刻铺出来的区间表。
   *
   * 同步回调要用它做二分,而回调也在滚动事件里跑、那时拿不到渲染期的值,所以在
   * 每次渲染之后把表放进 ref。渲染期间不写 ref:渲染要保持是纯的。
   */
  const spansRef = useRef<readonly RowSpan[]>([])

  /** 开场那一次定位只做一次,而且要等几何定下来之后才做。 */
  const opened = useRef(false)

  /*
   * 一次读取,三个派生量。
   *
   * 分开写会读三次几何,还会让三个真源在时间上错开。这里全部是读,没有写夹在
   * 中间,所以不会有强制回流。
   *
   * 三个 setState 都直接写值:React 对 Object.is 相等的新值本来就跳过重渲染,
   * 手写一个"相等就返回原值"的更新器,只是把官方行为抄了一遍,还会让读者以为
   * 这里有什么特殊语义。
   */
  const syncScrollState = useCallback(
    (viewport: HTMLDivElement) => {
      const distance = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop

      setIsPinnedToEnd(distance <= BOTTOM_THRESHOLD_PX)

      /*
       * 上边界在同一次读取里回答,不另开一个观察者。
       *
       * 通行的写法是在流的顶部挂一个哨兵元素配一个 IntersectionObserver。那
       * 要多一个 DOM 节点、多一条生命周期,而哨兵在虚拟化列表里本来就难摆 ——
       * 它必须落在画布之外,否则会被虚拟器算进总高。而 scrollTop 已经在手上,
       * 判据就是一个减法,和上面那个贴底判据是同一句话的两头。
       */
      if (viewport.scrollTop <= PREFETCH_START_PX) {
        onReachStart?.()
      }

      const spans = spansRef.current
      const reading = rowAtAnchor(
        spans,
        viewport.scrollTop + viewport.clientHeight * READING_ANCHOR_RATIO,
      )

      if (reading !== null) {
        setReadingRow(reading)
      }

      /* 顶行只为一件事:回答那次跳转到了没有。 */
      const top = rowAtAnchor(spans, viewport.scrollTop)

      if (top !== null) {
        settleReveal(top)
      }
    },
    [onReachStart, settleReveal],
  )

  /*
   * 只听滚动区自己的滚动。
   *
   * 原生 scroll 不冒泡,而 React 的 onScroll 会:它把这类事件委托到根容器捕获,
   * 再沿 React 树模拟一次冒泡。写成 onScroll,代码块、思考过程、工具输出 —— 任何
   * 一个后代滚动容器动一下,这里都会被叫醒,然后拿外层的几何去翻转锚点,整条对话
   * 随之重排。那不是滚动链接,contain 挡不住,它是事件层的串线。
   *
   * 所以监听挂在元素上,由 ref 回调负责装卸:内层滚动在事件层就到不了这里,不需要
   * 任何 target 比对 —— 比对是让错误先进门再赶出去,而这里可以让它根本进不来。
   * passive:读一个已有的几何量,永远不该让滚动等我们。
   *
   * 跳转闩锁的放弃路径也装在这里。它听的是输入设备事件,与滚动同源、同寿、同一个
   * 装卸点 —— 一个滚动区,一处装卸,没有第二条生命周期要维护。
   */
  const bindViewport = useCallback(
    (viewport: HTMLDivElement | null) => {
      viewportRef.current = viewport

      if (viewport === null) {
        return
      }

      const handleScroll = () => {
        syncScrollState(viewport)
      }

      viewport.addEventListener('scroll', handleScroll, { passive: true })

      const unwatch = watchReveal(viewport)

      return () => {
        viewport.removeEventListener('scroll', handleScroll)
        unwatch()
        viewportRef.current = null
      }
    },
    [syncScrollState, watchReveal],
  )

  /*
   * 一次主动跳转期间,末端不再是家。
   *
   * anchorTo 与 followOnAppend 原本只看"忙不忙"和"贴没贴底",跳转不在它们的判据
   * 里 —— 于是流式输出时点开上面某一轮,会同时挨两下:末端反推让落点随每一次吐字
   * 整体位移,追随又把视口拽回最新一条。两者都在做正确的事,只是没人告诉它们人已经
   * 走开了。
   *
   * 所以把"人已经走开了"变成一个显式的事实,让它排在前面。这不是兼容层,是优先级:
   * 导航是人下的指令,自动跟随是默认行为,指令高于默认。
   */
  const revealing = pending !== null

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
    scrollMargin,
    /*
     * 哪一侧稳定，取决于此刻正在发生什么 —— 它不是一个常量。
     *
     * end 模式下位置从末端反推，于是任何一次总高度变化都会让上方所有行整体
     * 位移：展开一行长高多少，上面的一切就上移多少。这正是「点开思考过程，
     * 界面莫名向上」的出处，而它与抽屉无关 —— 抽屉只是长高了。
     *
     * end 只有一个真实理由：流式输出时，贴在末端的人要跟着最后一条长高。那是
     * 一个特例，所以让它以特例的形式出现。其余一切时刻用 start：一行长高只推
     * 它下面的内容，偏移从顶部量起、原本就不变，被展开的那一行天然留在原地。
     * 没有错误发生，也就没有任何需要纠正的东西 —— 补偿本身就是那道抖动。
     *
     * 跳转也归入 start,而且优先于末端:落点之上的行此后才被真正测量,估高与
     * 真高的全部落差都会在那里结算。从顶部量起,这些落差发生在视口之外;从末端
     * 反推,它们会推着落点走 —— 那就是"跳过去之后又滑一下"。
     *
     * 历史回填仍然安全：它只发生在人向上读的时候，而那时增长在视口之上，由
     * 稳定的 getItemKey 认回同一条并保持它的视觉位置。
     */
    anchorTo: !revealing && isBusy && isPinnedToEnd ? 'end' : 'start',
    /* 人正在别处看的时候,新消息不夺取视口。 */
    followOnAppend: !revealing,
    scrollEndThreshold: BOTTOM_THRESHOLD_PX,
    overscan: OVERSCAN_ROWS,
  })

  const items = virtualizer.getVirtualItems()

  /*
   * 每一次布局之后,唯一的那次几何读取。
   *
   * 三件事按依赖顺序排,用早返回表达"上一步还没定,这一轮不作数":
   *
   *   1. 画布偏移。它是虚拟器全部偏移的基准,基准不对,下面两步算什么都没意义。
   *      写回 state 会引起一次重渲染,而布局效应里的 setState 是在绘制之前
   *      同步冲刷的,所以人看不到中间态。
   *   2. 区间表。基准对了,虚拟器给出的位置才可用。
   *   3. 开场定位,或者位置同步。开场那一次必须排在基准之后 —— 这正是它以前
   *      出错的地方:它当时是一个独立的 [virtualizer] 效应,必然在首帧、也就是
   *      scrollMargin 还是 0 的时候跑。
   *
   * 不会自激:画布偏移由滚动区的内边距与页眉决定,与画布自身的高度无关
   * (样式里 flex: none),所以写回 scrollMargin 不会反过来改变 offsetTop;
   * 另外两个写入都由 React 的等值短路兜底。
   */
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const canvas = canvasRef.current

    if (viewport === null || canvas === null) {
      return
    }

    const offset = canvas.offsetTop

    if (offset !== scrollMargin) {
      setScrollMargin(offset)

      return
    }

    spansRef.current = items

    if (!opened.current) {
      opened.current = true
      virtualizer.scrollToEnd()

      return
    }

    syncScrollState(viewport)
  })

  /*
   * 跳转是意图的效应,不是点击的副作用。
   *
   * 写成点击时直接 scrollToIndex 是错的:意图要先改变 anchorTo 与 followOnAppend,
   * 而那要等下一次渲染 —— 同步调用会让跳转本身发生在旧策略下,恰好绕开了这套设计
   * 想要的那条保证。放进效应里,顺序由 React 保证,不由调用顺序碰运气。
   *
   * 而且必须是瞬移。平滑滚动在这里不是一个体验选项:行是动态测量的(下面的
   * measureElement),平滑滚动要求目标偏移在一段动画期间保持不变 —— 途中每挂载
   * 一行,估高就被真高替换一次,总高度与偏移随之改变,目标自己跑掉了。这也正是
   * 虚拟化的收益所在:瞬移只挂载落点周围的十来行,与会话多长无关;平滑滚动会让
   * 滚动位置连续经过中间每一个像素,于是中间每一行都要挂载、测量、卸载一遍 ——
   * 那等于把整条会话读了一遍。
   *
   * 落点的稳定不靠动画去掩饰,靠 anchorTo 'start' 去保证;高亮的连续不靠动画去补,
   * 靠闩锁去锁。
   */
  useLayoutEffect(() => {
    if (pending === null) {
      return
    }

    virtualizer.scrollToIndex(pending, { align: 'start' })
  }, [pending, virtualizer])

  /*
   * 高亮的真源,按优先级排。
   *
   * 人刚要求看的那一轮最权威;其次是视线推出来的那一行;两者都还没有的那一帧 ——
   * 只有首帧 —— 是末尾,因为上面的布局效应刚把视口送到那里。原先这里写 0,于是
   * 开场必然先亮第一轮再跳到最后一轮。
   */
  const activeRow = pending ?? readingRow ?? Math.max(0, rows.length - 1)

  const scrollToRow = useCallback(
    (index: number) => {
      beginReveal(index)
    },
    [beginReveal],
  )

  return (
    <div className="agent-activity-feed" data-scrollbar-track>
      <div className="agent-activity-feed__viewport" ref={bindViewport}>
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

      {overlay === undefined ? null : overlay({ activeRow, scrollToRow })}
    </div>
  )
}
