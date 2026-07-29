import { useCallback, useLayoutEffect, useRef } from 'react'

/* poietica:conversation-minimap-fold@v23 */

/** 一次折叠该走多久。比鱼眼慢一点:这是布局变化,不是指针跟随。 */
const DURATION_MS = 180
const EASING = 'cubic-bezier(0.2, 0, 0, 1)'
const ID_ATTR = 'data-rail-id'

/**
 * 折叠与展开之间的位移,补成连续的。
 *
 * 并格不是把几根杠叠起来,是几个节点被一个节点顶替 —— 所以 CSS 过渡无从下手:
 * 它只能过渡活着的元素的属性,过渡不了"五个变一个"。这里走 FLIP:先让 React
 * 把布局落到终点,再读出每一格挪了多远,用 transform 把它推回原位,然后放开。
 *
 * 顺序是关键。真实布局在第 0 帧就已经是最终布局,动画只是视觉上的回溯 —— 所以
 * 动画期间按下去,命中的是那一格将要去的地方,而不是眼睛看到的地方。反过来做
 * (拿真实布局做动画)目标会从光标底下走开,点击落空。
 *
 * 用 Web Animations API 而不是内联 transition:不需要强制回流来断开过渡,也
 * 不需要事后清理内联样式,而且 transform 走合成层,不碰布局。
 *
 * 消失的那几格没有动画 —— 它们已经从 DOM 里出去了,要画出被吸进去的轨迹得把
 * 卸载的节点留成幽灵层。整列同时滑动才是这一下的主导运动,先不为那 3px 建一
 * 套机制。
 *
 * 不带依赖数组:这个组件被 memo 包着,滚动帧里根本不重渲染,所以每一次重渲染
 * 几乎都伴随布局变化。没变的格子 delta 为 0,直接跳过,不会平白起一个动画。
 */
export function useFoldFlip(): (node: HTMLElement | null) => void {
  const nodeRef = useRef<HTMLElement | null>(null)
  const beforeRef = useRef<Map<string, number>>(new Map())

  const ref = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node
  }, [])

  useLayoutEffect(() => {
    const node = nodeRef.current

    if (node === null) {
      return
    }

    const view = node.ownerDocument.defaultView

    if (view === null) {
      return
    }

    const before = beforeRef.current
    const after = new Map<string, number>()
    const bars = node.getElementsByClassName(
      'conversation-minimap__turn',
    ) as HTMLCollectionOf<HTMLElement>

    /* 先读完再写。读 offsetTop 会 flush 布局,读写交替就是每格一次回流。 */
    for (const bar of bars) {
      const id = bar.getAttribute(ID_ATTR)

      if (id !== null) {
        after.set(id, bar.offsetTop)
      }
    }

    beforeRef.current = after

    /* 头一回挂载没有"之前",整条轨道不该从别处飞进来。 */
    if (before.size === 0) {
      return
    }

    if (view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    for (const bar of bars) {
      const id = bar.getAttribute(ID_ATTR)

      if (id === null) {
        continue
      }

      const to = after.get(id)

      if (to === undefined) {
        continue
      }

      const from = before.get(id)

      /* 新长出来的一格:它是从某个簇里裂出来的,没有来处可言,淡进来。 */
      if (from === undefined) {
        bar.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION_MS, easing: EASING })

        continue
      }

      if (from === to) {
        continue
      }

      bar.animate([{ transform: `translateY(${String(from - to)}px)` }, { transform: 'none' }], {
        duration: DURATION_MS,
        easing: EASING,
      })
    }
  })

  return ref
}
