import './agent-activity-feed.css'

import type { FeedRow } from '@poietica/agent-timeline'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { type RowSpan, rowAtAnchor } from './reading-position'
import { useDevicePixels } from './use-device-pixels'
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
  user_message: 72,
  agent_text: 240,
  agent_thought: 120,
  tool_call: 160,
  plan: 200,
  permission: 140,
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
 * 这个组件只画会话态:一个滚动区,加一层不随滚动移动的浮层。
 *
 * 入口态不是它的一种姿势 —— 它此前是,靠 feed 根上两个伪元素的 flex-grow 在
 * "居中"与"落底"之间插值;开场白与输入框因此是它的两个插槽。那套东西已经删掉,
 * 理由见 assistant.css:位置不该是一个可以被补间的数字。开场白与输入框现在由
 * AssistantSurface 持有,这个组件不知道它们存在。
 *
 * 滚动位置只有一个所有者:虚拟器。末端锚定、追随新消息、贴底阈值,以及流式输出时
 * 最后一行长高的增量补偿,都由 anchorTo 这套原语承担 —— 这正是它们存在的理由,
 * 不该在产品代码里复刻。浏览器原生的滚动锚定因此在样式里显式关闭:两个纠正者对
 * 同一次尺寸变化各补偿一次,位移就会翻倍。
 *
 * 本组件不做任何几何计算 —— 除了四个派生量,而它们共用一次读取:转录相对滚动区
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
  /**
   * 转录之后、滚动区之内。
   *
   * 用于属于这一轮而不属于其中某一条的东西,例如等待。缺席就是缺席:undefined,
   * 不是 null。
   */
  readonly footer?: ReactNode
  /** 画在滚动区之上,位于一切会滚的东西之外。 */
  readonly overlay?: (port: FeedPort) => ReactNode
}

export function AgentActivityFeed({
  rows,
  renderRow,
  isBusy,
  footer,
  overlay,
}: AgentActivityFeedProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  /*
   * 行的落点要踩在设备像素上。
   *
   * item.start 是 measureElement 测回的高度累加 —— 小数,而且同屏就有现成的
   * 小数源(.assistant-permission__ask 是 13px × 1.6 = 20.8px)。落在半个设备
   * 像素上,这一行里所有 1px 的边就被摊到两行、墨色减半:一张卡的外框因此在
   * 同一屏上时而是 1px #e0e0e0、时而是 2px #ececec。取整只动这一处 —— 位置
   * 只有一个写入点,所以对齐也只需要一个。
   */
  const snapToDevicePixels = useDevicePixels()

  /*
   * 转录相对滚动区的偏移:转录上面还有滚动区自己的上内边距,这段距离必须告诉
   * 虚拟器,否则它算出来的位置会整体上移那么多。
   *
   * 它是 state 而不是 ref。曾经是 ref,理由写的是"进 state 会让开场那段 flex-grow
   * 动画每一帧都重渲染整条对话" —— 那段动画连同两个撑开的伪元素已经不存在了,
   * 而这个理由当时也不成立:CSS 过渡期间根本不产生 React 渲染。
   *
   * 而 ref 的代价是实打实的:改 ref 不触发重渲染,虚拟器在渲染期读到的 scrollMargin
   * 会一直停在首帧的 0,挂载时的 scrollToEnd 正好落在那之前 —— 初次打开必定差一个
   * 转录偏移。
   *
   * 滚动区是转录的 offsetParent(样式里的 position: relative),所以这是一次
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
   * 本帧已经排好的那次几何读取。
   *
   * 0 表示没有。一次滚轮滚动派发几十个事件,而它们读的是同一帧的同一份布局:
   * 读第二次不会得到新答案,只会多两次二分和三次 setState。
   */
  const frame = useRef(0)

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
    [settleReveal],
  )

  /*
   * 几何读取一帧一次。
   *
   * 合并到 rAF 之后,读取次数与帧数对齐 —— 那也是浏览器唯一保证布局稳定的
   * 时机。此前每一个 scroll 事件各读一遍,答案完全相同。
   */
  const scheduleSync = useCallback(() => {
    if (frame.current !== 0) {
      return
    }

    frame.current = requestAnimationFrame(() => {
      frame.current = 0

      const viewport = viewportRef.current

      if (viewport !== null) {
        syncScrollState(viewport)
      }
    })
  }, [syncScrollState])

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

      viewport.addEventListener('scroll', scheduleSync, { passive: true })

      const unwatch = watchReveal(viewport)

      return () => {
        viewport.removeEventListener('scroll', scheduleSync)

        if (frame.current !== 0) {
          cancelAnimationFrame(frame.current)
          frame.current = 0
        }

        unwatch()
        viewportRef.current = null
      }
    },
    [scheduleSync, watchReveal],
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
     * 打开一条对话时整条一次到齐，所以不存在向上补一段历史这回事，也就没有
     * 视口之上的增长需要考虑。
     */
    anchorTo: !revealing && isBusy && isPinnedToEnd ? 'end' : 'start',
    /* 人正在别处看的时候,新消息不夺取视口。 */
    followOnAppend: !revealing,
    scrollEndThreshold: BOTTOM_THRESHOLD_PX,
    overscan: OVERSCAN_ROWS,
  })

  const items = virtualizer.getVirtualItems()

  /*
   * 区间表是渲染的产物,不是几何的产物。
   *
   * 它每次渲染都要更新 —— 虚拟器铺出来的区间就是这一帧的事实 —— 但这里一个
   * 布局量都不读,所以它不再拖着一次强制回流。
   */
  useLayoutEffect(() => {
    spansRef.current = items
  }, [items])

  /*
   * 转录偏移只在它真的会变的时候量。
   *
   * 此前这次 offsetTop 挂在一个无依赖的布局效应里:每一次渲染强制一次同步
   * 布局,紧接着 syncScrollState 又读三个几何量再写三个 state —— 流式输出每
   * 个 token 一次渲染,那就是每个 token 两次强制回流加一轮额外重渲染。而偏移
   * 由滚动区的内边距与页眉决定,与转录长度无关:它变,只可能是因为容器变了,
   * 而容器变了下面那个 ResizeObserver 会说。
   *
   * 开场定位仍然排在偏移之后 —— 基准不对,scrollToEnd 就差一个偏移 —— 并且
   * 多了一个条件:表里得有东西。此前它在首帧就把 opened 置真,于是从列表打开
   * 一段既存对话时,那一次 scrollToEnd 落在空表上,而它再也不会重来。
   */
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const transcript = transcriptRef.current

    if (viewport === null || transcript === null) {
      return
    }

    const offset = transcript.offsetTop

    if (offset !== scrollMargin) {
      setScrollMargin(offset)

      return
    }

    if (opened.current || items.length === 0) {
      return
    }

    opened.current = true
    virtualizer.scrollToEnd()
  }, [items.length, scrollMargin, virtualizer])

  /*
   * 尺寸变了,同一个滚动位置就对应到另一行上。
   *
   * 流式输出把行撑高、面板被拖窄、抽屉展开 —— 三者都改变几何,都不产生滚动
   * 事件。此前靠"每次渲染后重读一遍"覆盖,那是用一次强制回流去换一个通知;
   * ResizeObserver 就是这个通知的官方形态,而且它连不经过 React 的尺寸变化
   * (图片解码完成、字体换页)也一并覆盖。
   */
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const transcript = transcriptRef.current

    if (viewport === null || transcript === null) {
      return
    }

    const observer = new ResizeObserver(scheduleSync)

    observer.observe(viewport)
    observer.observe(transcript)

    return () => {
      observer.disconnect()
    }
  }, [scheduleSync])

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
        <div
          aria-busy={isBusy}
          className="agent-activity-feed__transcript"
          ref={transcriptRef}
          role="log"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {/*
           * 一次位移，不是每行一次。
           *
           * TanStack Virtual 官方的 dynamic 示例正是这个形状：窗口整体平移到首个
           * 虚拟行的起点，行本身按文档流首尾相接。此前每一行各带一个内联 transform，
           * 于是每一帧都要为可见的每一行新建一个 style 对象、写一次内联声明 ——
           * 而行与行之间的相对位置本来就是它们各自的高度，用不着再算一遍。
           *
           * 设备像素对齐因此也只剩一处：位移只有一个写入点，对齐也只需要一个。
           * 行上不再有任何内联样式，未变的行在 React 那侧的属性差分因此是空的。
           */}
          <div
            style={{
              transform: `translateY(${String(
                snapToDevicePixels((items[0]?.start ?? 0) - scrollMargin),
              )}px)`,
            }}
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
                >
                  {renderRow(row)}
                </div>
              )
            })}
          </div>
        </div>

        {footer === undefined ? null : <div className="agent-activity-feed__footer">{footer}</div>}
      </div>

      {overlay === undefined ? null : overlay({ activeRow, scrollToRow })}
    </div>
  )
}
