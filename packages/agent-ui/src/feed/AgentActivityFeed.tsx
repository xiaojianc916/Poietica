import './agent-activity-feed.css'

import type { FeedRow } from '@poietica/agent-timeline'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useDevicePixels } from '../primitives/use-device-pixels'
import { type RowSpan, rowAtAnchor } from './reading-position'
import { useDrawerMotion } from './use-drawer-motion'
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
const ESTIMATED_ROW_PX: Record<FeedRow['item']['type'], number> = {
  user_message: 72,
  agent_text: 240,
  agent_thought: 120,
  tool_call: 160,
  plan: 200,
  /*
   * 权限请求在这一层什么都不画。
   *
   * TimelineRow 的 case 'permission' 交回 null，理由写在那里：应答一次请求要
   * 拿着会话，而行渲染器不该持有它，所以它由 surface 画。于是这一行在转录里
   * 只是一个占位，实测高度就是 __row 自己那两道 --cp-feed-row-gap。
   *
   * 此前这一格是 140 —— 七档里第三高，而它对应的渲染结果是空。上面那句「落差
   * 越大,虚拟器要补偿的滚动增量越大」在这一格上正好是自己打自己：一次权限请求
   * 上屏,虚拟器先按 140 铺一行,测回来十几个像素,再倒着补偿一次。
   *
   * 0 是可证的：空内容的内容高度就是 0，行距由 CSS 另加。按这张表自己声明的
   * 口径 ——「估小了只是补偿一次,估大了会在到达前留白」—— 0 落在安全的那一侧。
   */
  permission: 0,
  error: 96,
}

/*
 * 下标越界时的兜底。
 *
 * 表的类型收窄到条目类型的联合之后,它对每一个类型都有值 —— 这不是约定,是
 * TimelineRow 末尾那个 unhandled(_item: never) 已经证过的事：那个 switch 穷尽,
 * 这张表就与它对齐,以后新增一个条目类型会在这两处同时编译失败。
 *
 * 所以这个常量不再是「未知类型的估高」,它只剩一件事：这一行根本不存在。
 */
const ESTIMATED_FALLBACK_PX = 120

/**
 * 距末端多近算作「仍在看最新一条」。约等于一格滚轮。
 *
 * 只交给虚拟器：scrollEndThreshold 是 followOnAppend 与 isAtEnd() 共用的判据，
 * 官方 Chat 指南给的参考值是 80，这里取一格滚轮的量。
 */
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
   * 用于属于这一轮而不属于其中某一条的东西，例如等待。缺席就是缺席：undefined，
   * 不是 null。
   *
   * 它落在转录末端由 paddingEnd 预留出的那块空间里，因此仍然跟着一起滚，而虚拟器
   * 知道它占了多少 —— 「转录之后」与「滚动区之内」不再是两个互相不知道的事实。
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
  /*
   * 本帧的行表，给虚拟器的选项函数同步读。
   *
   * 官方对 getItemKey 与 estimateSize 的要求是把函数 memo 住 —— 它们是虚拟器
   * 判断测量缓存要不要作废的依据。而把 rows 写进依赖数组等于没有 memo：转录
   * 每帧重投影（reducer 的 freeze 交出新 items，选择器据此重排 rows），rows
   * 于是恒定每帧换引用，[rows] 这个依赖数组永远不命中。上一版把内联箭头换成
   * useCallback 时行为一个字节都没变，只多了一次依赖比较 —— 注释说自己 memo
   * 住了，依赖数组说没有。
   *
   * 结果是流式输出的每一个 token 都换一次身份函数，测量缓存整表作废，虚拟化
   * 的收益被反转成每帧全表重测。
   *
   * 镜像进 ref 之后两个函数的身份恒定，而读到的仍是本帧的行。赋值只能发生在
   * 渲染期：虚拟器就是在渲染期调用它们的，推迟到效应里就晚了一帧。
   */
  const rowsRef = useRef(rows)

  rowsRef.current = rows

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const tailRef = useRef<HTMLDivElement | null>(null)

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
   * 转录之后还有多少东西。
   *
   * scrollMargin 说的是转录之前，这个说的是转录之后，两者必须成对存在：滚动盒的
   * 末端等于 scrollMargin + getTotalSize() + 这一段，而虚拟器算末端时只用前两项。
   * 少声明一头，它的「底」就永远比真正的底高出这么多 —— 那正是流式输出停下之后
   * 还能再往下拨一点的距离，而且它落在 BOTTOM_THRESHOLD_PX 的容差里，所以既不会
   * 被察觉、也不会被纠正。
   *
   * 交给 paddingEnd 之后，这段空间进入虚拟器的坐标系，两个末端合成一个。数值是实
   * 测的而不是抄自令牌：尾部里装着等待指示器，高度本来就不是常量，而抄一份令牌就
   * 意味着 CSS 改了这里不会跟。
   */
  const [tailSize, setTailSize] = useState(0)

  /*
   * 视线落在哪一行。
   *
   * null 是"还没读到过",不是"第 0 行"。首帧的布局效应会把视口送到末尾,那一帧
   * 还没有任何几何可读,若此时谎称 0,缩略导航会先高亮第一轮再跳到最后一轮 ——
   * 开场那一下闪跳就是这么来的。
   */
  const [readingRow, setReadingRow] = useState<number | null>(null)

  /*
   * 是否有抽屉正在改某一行的高度，以及这件事发生在空闲时。
   *
   * 它只服务一件事：抽屉动的时候，末端锚定要让位。理由在库的源码里 ——
   * resizeItem 中，anchorTo 为 end 且 getVirtualDistanceFromEnd() 落在
   * scrollEndThreshold 之内时，任何一行长高都会走
   *
   *   applyScrollAdjustment(getTotalSize() - prevTotalSize)
   *
   * 也就是把这次长高原样加到 scrollTop 上。这对流式输出的最后一条是对的
   * （末端钉住），对读者亲手点开的抽屉是错的：整条转录跟着上移，面板于是
   * 看起来是向上长出来的。
   *
   * 调小 scrollEndThreshold 躲不掉。判据是「距末端 <= 阈值」，而人看完一条
   * 回复停在的位置距末端就是 0，任何非负阈值都成立。何况那个数还兼着
   * followOnAppend 与 isAtEnd 的判据（官方 API 文档原话），调小它等于让
   * 新消息不再自动跟到底部 —— 一个数两份工，修一头砸另一头。
   *
   * 库给的 shouldAdjustScrollPositionOnItemSizeChange 也够不着：它是
   * wasAtEnd 的 else 分支。所以唯一的开关就是 anchorTo 本身。
   *
   * 让位期间走库的默认判据：只补偿整个都在视口上方的行。视口上方的抽屉展开
   * 仍然保持读者的位置不动，视口内的抽屉直接向下长。两者都是要的。
   *
   * 让位还有一个前提：只在空闲时。库的 setOptions 里，followOnAppend 的整段
   * 判断包在 merged.anchorTo === "end" 里头 —— 让位期间若正好来了一段追加，
   * 这次跟随被整个跳过；跟随漏一次，视口就落后一个分块，下一次
   * isAtEnd(scrollEndThreshold) 不再成立，于是再也回不来，表现就是滑到底了
   * 界面还没到底。所以 isBusy 为真时锚点一步不让：回复在流的时候，追加与
   * 增长照常跟随；回复停了才允许让位，而那时候没有东西会被追加，也就没有
   * 东西会丢。
   *
   * 这同时是第三道保险：万一让位状态因为任何原因没收回来，下一轮开始时
   * isBusy 转真，锚点自己就回到末端。
   *
   * 「正在动」不自己记账，读的是活动动画表，理由见
   * use-drawer-motion —— 它与 useRevealIntent 同形：一个 watch，交回一个卸载函数。
   *
   * 一个诚实的边界：prefers-reduced-motion 下过渡被关掉，不发事件，这次让位
   * 也就不发生，那种情况下仍会上移一次。不为它加兜底定时器 —— 那是拿一个
   * 猜测去补一个已知的缺口。
   */
  const { moving: drawersMoving, watch: watchDrawers } = useDrawerMotion(transcriptRef)

  const {
    pending,
    begin: beginReveal,
    settle: settleReveal,
    watch: watchReveal,
  } = useRevealIntent()

  /*
   * 虚拟器此刻铺出来的区间表。
   *
   * 同步回调要用它做二分,而回调在滚动事件里跑、拿不到渲染期的值,所以把本帧
   * 的表镜像进 ref —— 与上面的 rowsRef 同一处做法、同一个时机。
   *
   * 此前它走 useLayoutEffect([items])。而 items 是 getVirtualItems() 的返回值,
   * 每帧都是新数组:那个效应因此每帧必跑一次加一次依赖比较,做的事与一行赋值
   * 逐字相同。同一个文件里两种相反的做法,注释还互相打脸——上面那句说"赋值只能
   * 发生在渲染期",这里说"渲染期间不写 ref"。留一个。
   */
  const spansRef = useRef<readonly RowSpan[]>([])

  /** 开场那一次定位只做一次,而且要等几何定下来之后才做。 */
  const opened = useRef(false)

  /*
   * 本帧已经排好的那次几何读取。
   *
   * null 表示没有。一次滚轮滚动派发几十个事件,而它们读的是同一帧的同一份布局:
   * 读第二次不会得到新答案,只会多两次二分和三次 setState。
   */
  const frame = useRef<number | null>(null)

  /*
   * 一次读取，两个派生量。
   *
   * 分开写会读两次几何，还会让两个真源在时间上错开。这里全部是读，没有写夹在
   * 中间，所以不会有强制回流。
   *
   * 曾经是三个：还有一个「人是不是贴在末端」。它被删掉不是因为多余，而是因为
   * 它是第二个答案 —— 虚拟器用 scrollEndThreshold 判同一件事，判得比这里早一帧，
   * 而且量的是自己的末端而不是 DOM 的末端。同一个问题有两个答案时，问题不在
   * 哪个更准，在于不该有两个。
   */
  const syncScrollState = useCallback(
    (viewport: HTMLDivElement) => {
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
    if (frame.current !== null) {
      return
    }

    frame.current = requestAnimationFrame(() => {
      frame.current = null

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

      /* 一个滚动区，一处装卸：两处订阅各自交回自己的卸载函数。 */
      const unwatchDrawers = watchDrawers(viewport)
      const unwatchReveal = watchReveal(viewport)

      return () => {
        viewport.removeEventListener('scroll', scheduleSync)

        if (frame.current !== null) {
          cancelAnimationFrame(frame.current)
          frame.current = null
        }

        unwatchDrawers()
        unwatchReveal()
        viewportRef.current = null
      }
    },
    [scheduleSync, watchDrawers, watchReveal],
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

  /*
   * 条目的身份函数，记住不重建。
   *
   * 官方在 getItemKey 的说明里专门补了一句：虚拟器虽然会自行判断哪些选项影响测量
   * 并适时作废缓存，仍然建议把它 memo 住。此前是内联箭头，每次渲染换一个身份函数 ——
   * 流式输出每个 token 一次渲染，就是每个 token 换一次，而它恰好是末端锚定跨数据
   * 变化认人的那个函数。
   *
   * 身份是 id 不是序号：恢复会话与回填历史都会让每一条换序号，用序号当身份，锚点
   * 会在那之后落到别的条目上。官方同样点名过这一条 ——「Index keys cannot distinguish
   * prepends from appends after items shift」。
   */
  const getItemKey = useCallback((index: number) => rowsRef.current[index]?.item.id ?? index, [])

  const estimateSize = useCallback((index: number) => {
    const type = rowsRef.current[index]?.item.type

    /*
     * 只剩一个分支：有没有这一行。
     *
     * 此前那个 ?? 是类型宽度的产物 —— 表写成 Record<string, number> 就宽到能接
     * 任何字符串,编译器于是再也证明不了它是全的,兜底成了必需品。收窄之后它是
     * 可证不可达的:留着它,读的人会以为存在某个类型落不进这张表。
     */
    return type === undefined ? ESTIMATED_FALLBACK_PX : ESTIMATED_ROW_PX[type]
  }, [])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    /* 两个选项函数的身份恒定，定义与理由见上方 rowsRef。 */
    estimateSize,
    getItemKey,
    scrollMargin,
    paddingEnd: tailSize,
    /*
     * 会话流是末端锚定的，恒定如此。
     *
     * 这里曾经按「不在跳转 && 忙 && 贴底」在 start/end 之间来回切。三个判据都
     * 是对的问题，但都问错了地方 —— 官方 Chat 指南把它们各自的归属写得很清楚：
     *
     *   anchorTo 'end'  —— 末端被钉住时，最后一条流式长高要跟着
     *   followOnAppend  —— 只有在追加之前就已经贴底，才跟随新消息
     *   scrollEndThreshold —— 「够不够近算贴底」由它判
     *
     * 也就是说，那三个条件里有两个本来就在库内部、按同一份坐标、在数据变化那
     * 一刻同步求值。在外面用 React state 再判一遍，得到的是同一个答案的延迟版，
     * 而它却决定着模式翻不翻面。anchorTo 是模式不是开关：库为它维护一个待定
     * 锚点，模式在两次渲染之间换掉，锚点的含义也就换了。
     *
     * 于是这里只留立场：这是一条会话流，它的稳定侧永远是末端。
     *
     * 唯一的例外是抽屉：读者亲手改变一行的高度时，末端锚定会把这次长高加到
     * scrollTop 上，面板于是向上长。那段时间锚点让给 start，理由与判据写在
     * 上面 drawersMoving 那里。这不是把模式当开关用 —— 立场没变，会话流的稳定
     * 侧仍然是末端；变的是「谁引起了这次尺寸变化」，而库自己不区分。
     */
    anchorTo: drawersMoving && !isBusy ? 'start' : 'end',
    /* 人正在别处看的时候,新消息不夺取视口。 */
    followOnAppend: !revealing,
    scrollEndThreshold: BOTTOM_THRESHOLD_PX,
    overscan: OVERSCAN_ROWS,
    /*
     * 滚动停没停，问浏览器。
     *
     * 这个选项默认 false，库于是退回一个 isScrollingResetDelay 的定时器去猜。官方
     * 写明了那条退路存在的理由：「until all browsers uniformly support the scrollEnd
     * event」。这里的渲染器是 WebView2，只有 Chromium，原生 scrollend 早已可用 ——
     * 一个为跨浏览器差异准备的降级，在一个单引擎的桌面应用里只是一个会晚 150ms
     * 的猜测。
     */
    useScrollendEvent: true,
  })

  const items = virtualizer.getVirtualItems()

  /* 区间表是渲染的产物,不是几何的产物:这里一个布局量都不读。 */
  spansRef.current = items

  /*
   * 量，然后交出去。这里一个字都不写回 DOM。
   *
   * 末端的位置只能通过交给虚拟器的那几个数（scrollMargin / paddingEnd / anchorTo）
   * 去表达。绕过它去写滚动位置的路子试过两条，都坏在同一件事上：直接写
   * viewport.scrollTop 是引入第二个所有者，与末端锚定对同一次尺寸变化各补偿一次；
   * 改走 virtualizer.scrollBy 也不行 —— 它内部是 scrollToOffset(getScrollOffset() + d)，
   * 写的是绝对位置，而这里开着 useScrollendEvent，滚动状态收敛推迟到 scrollend，
   * 尾部尺寸在这期间一变，基准就过期了。两次的症状一模一样：滑到底也到不了底。
   *
   * 「输入框长高时最后一行与它的距离会变」这件事仍然成立，但解法只能在唯一那个
   * 所有者里面：改这几个数的含义，或者换掉整套锚定模型。
   */
  const measureBounds = useCallback(() => {
    const transcript = transcriptRef.current
    const tail = tailRef.current

    if (transcript !== null) {
      setScrollMargin(transcript.offsetTop)
    }

    if (tail !== null) {
      setTailSize(tail.offsetHeight)
    }
  }, [])

  /*
   * 开场那一次定位，只做一次，而且要等基准定下来。
   *
   * 这里仍然读一次 offsetTop：偏移那一步可能刚刚把它改过，而 scrollToEnd 用的是
   * 上一次渲染的 scrollMargin，基准不对就差一整个偏移。但这道门前面挡着
   * opened.current —— 整个生命周期最多几次，不是每次滚动几次。
   *
   * 表里得有东西。此前它在首帧就把 opened 置真，于是从列表打开一段既存对话时，
   * 那一次 scrollToEnd 落在空表上，而它再也不会重来。
   */
  useLayoutEffect(() => {
    const transcript = transcriptRef.current

    if (opened.current || transcript === null || items.length === 0) {
      return
    }

    if (transcript.offsetTop !== scrollMargin) {
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

    if (viewport === null) {
      return
    }

    /*
     * 尺寸变了，两件事都得重算：同一个滚动位置对应到哪一行，以及转录相对滚动区
     * 的偏移。后者此前不在这里 —— 注释说「容器变了下面那个 ResizeObserver 会说」，
     * 而这个回调从头到尾没碰过 offsetTop。于是面板被拖窄却没有行数变化时，偏移
     * 停在旧值，虚拟器算出来的位置整体错开那么多。
     *
     * 但转录本身不在观察名单里，而它此前在。转录的高度就是 getTotalSize()，流式
     * 输出时每一帧都在长 —— 观察它等于给每一帧接上一条回路：尺寸变化叫醒回调，
     * 回调量一次边界、排一次同步、写两次 state，重渲染又把高度改一次。那也正是
     * 「ResizeObserver loop completed with undelivered notifications」的成因。
     *
     * 而这个回调要的两个量，一个都不来自转录的高度：偏移由滚动区的内边距与页眉
     * 决定，随滚动区一起变；尾部的高度由尾部自己报，它就在下面的名单上。转录
     * 唯一能贡献的是宽度变化，而宽度变化必然伴随滚动区的尺寸变化。
     */
    const observer = new ResizeObserver(() => {
      measureBounds()
      scheduleSync()
    })

    observer.observe(viewport)

    /*
     * 尾部要按边框盒观察，这不是一个可选项。
     *
     * 这个盒子的高度整个来自 padding-block-end（--cp-dock-clearance 加一段
     * 溶解带，见 agent-activity-feed.css）；它的内容盒里只有等待指示器，空闲
     * 时是 0。而 ResizeObserver 默认观察 content-box —— 内边距变化不派发。
     *
     * 于是输入框长高、问题面板长出来、或者 dock-clearance 在首帧之后才第一次
     * 写入真实高度时，实物长高了，而交给虚拟器的 paddingEnd 还停在旧值：转录
     * 框按旧值定高，尾部按新值向上占位，多出来的那一截压在最后几行上，正好被
     * 输入框盖住。滑到滚动条尽头，虚拟器认为到底了，内容还没到底。
     *
     * 冷启动必现：挂载时 clearance 还没被写，var() 走回退值 --cp-gutter，首测
     * 就偏小，而通知永远不来。一轮对话开头或结尾「自己好一下」，是等待指示器
     * 的出现与消失改变了内容盒，顺带把当时的正确值读了回来。
     *
     * measureBounds 读的一直是 offsetHeight，也就是边框盒。观察哪个盒子，就得
     * 是读哪个盒子 —— 两边说的必须是同一个量。
     */
    if (tailRef.current !== null) {
      observer.observe(tailRef.current, { box: 'border-box' })
    }

    return () => {
      observer.disconnect()
    }
  }, [measureBounds, scheduleSync])

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
    <div className="agent-activity-feed">
      <div className="agent-activity-feed__viewport" ref={bindViewport}>
        <div
          aria-busy={isBusy}
          className="agent-activity-feed__transcript"
          ref={transcriptRef}
          role="log"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {/*
           * 每行各自落位。
           *
           * 官方对布局策略给过两处建议，前提不同，上一版只引了一处就下了断言，
           * 这里如实写全：
           *
           *   Chat 指南 —— position absolute，transform 平移到 item.start。
           *   scrollToIndex 注记 —— 平滑滚动时首选「整块平移」，因为平滑滚动期间
           *     虚拟器只测量目标附近缓冲区内的条目，跳过的那些若各自定位就会错位。
           *
           * 本组件落在前者，理由是后者的前提在这里不存在：这里没有任何一次平滑
           * 滚动。跳转是 scrollToIndex(align 'start') 不带 behavior，开场是
           * scrollToEnd()，都是瞬移 —— 而瞬移是刻意的，行是动态测量的，平滑滚动
           * 要求目标偏移在动画期间保持不变，而它会自己跑掉。
           *
           * 于是这里取一致性：每一行都坐在虚拟器算出来的 start 上，模型说它在哪
           * 它就在哪。走文档流则只有首行的位置来自虚拟器，其余来自前面各行的真实
           * 高度 —— 那是第二个来源，且与虚拟器的表差着一次异步测量。
           *
           * 代价是每个可见行一个内联 style 对象，约十几个每帧。
           */}
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
                style={{
                  transform: `translateY(${String(snapToDevicePixels(item.start - scrollMargin))}px)`,
                }}
              >
                {renderRow(row)}
              </div>
            )
          })}
          {/*
           * 尾部坐在 paddingEnd 预留出来的那块空间里。
           *
           * 它此前是转录的兄弟，也就是「虚拟器看不见的地方」—— 滚动盒因此比虚拟
           * 器以为的更长。恒定挂载：末端的清空距离与等待指示器在不在无关，而一个
           * 会时有时无的元素会让末端的位置也时有时无。
           */}
          <div className="agent-activity-feed__tail" ref={tailRef}>
            {footer}
          </div>
        </div>
      </div>

      {overlay === undefined ? null : overlay({ activeRow, scrollToRow })}
    </div>
  )
}
