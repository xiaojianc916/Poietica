import { useCallback, useLayoutEffect, useRef } from 'react'

/*
 * 输入框跟着内容长高。
 *
 * 量的是这个元素自己：把 block-size 归零，读一次 scrollHeight，再把钳制后的
 * 值写回去。归零与写回落在同一段同步脚本里，浏览器要等脚本让出才绘制，所以
 * 中间那一步没有任何一帧看得见。
 *
 * 归零之后 min-block-size 会把「用过的值」按回静息高度，这不影响测量：
 * scrollHeight 报的是内容高度，内容比静息矮时本来就该按到静息高度。
 *
 * 此前这里量的是一个挂在 body 上的替身 div。它存在的唯一理由写在原注释里 ——
 * 「先归零再读 scrollHeight 不行：变化前的样式变成 auto，两端 auto → Npx 不可
 * 插值，过渡不启动」。那条推理对 CSS transition 成立，对下面这句 animate()
 * 不成立：Web Animations 的关键帧自带两个显式像素端点，浏览器不去读元素变化
 * 前的计算值。替身在这段路改用 WAA 的那一刻就失去了理由，只是没有人回头删。
 *
 * 删掉它同时删掉了一个不会报错的失效：替身要穿一身抄来的样式（盒模型、四个
 * 内边距、七项字体度量、断行规则），而那身衣服的失效条件只有「宽度变了」。
 * 字体加载完成、主题换掉字号都不改变宽度，替身于是拿旧度量量新文本。真元素
 * 没有这个问题：它的度量就是它自己的度量。
 */

/* 问一次就够。此前它长在每个字符都要跑的那条路上。 */
const STILLNESS =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

/** 走多远由样式表说了算，所以上下限从计算样式取，不在这里抄第二份。 */
interface Bounds {
  readonly ceiling: number
  readonly floor: number
}

const OPEN: Bounds = { ceiling: Number.POSITIVE_INFINITY, floor: 0 }

/**
 * 交回一个 ref 回调：把它挂到 textarea 上，高度就归这个 hook 管。
 *
 * text 只作为「内容变了」的信号传进来 —— 高度从元素量，不从这串字算。
 */
export function useAutosize(text: string) {
  const held = useRef<HTMLTextAreaElement | null>(null)
  const bounds = useRef<Bounds>(OPEN)
  /* 上一次取上下限时的宽度，上一次量过的文本，上一次写下去的高度。 */
  const sized = useRef(-1)
  const typed = useRef<string | null>(null)
  const applied = useRef(-1)
  const running = useRef<Animation | null>(null)

  /*
   * 零依赖，所以它终身是同一个函数 —— 下面那个观察器因此既不必重建，也不需要
   * 一个「取最新版」的中转 ref。
   */
  const measure = useCallback((source: string) => {
    const node = held.current

    if (node === null) {
      return
    }

    const width = node.clientWidth

    if (width === sized.current) {
      /* 同一串字、同一个宽度，高度不可能变。这一条早退在读任何布局之前。 */
      if (source === typed.current) {
        return
      }
    } else {
      sized.current = width

      const style = getComputedStyle(node)
      const ceiling = Number.parseFloat(style.maxBlockSize)
      const floor = Number.parseFloat(style.minBlockSize)

      bounds.current = {
        ceiling: Number.isFinite(ceiling) ? ceiling : Number.POSITIVE_INFINITY,
        floor: Number.isFinite(floor) ? floor : 0,
      }
    }

    typed.current = source

    /* 起点取眼睛看到的位置：上一次的动画可能还在跑，行内写着的是它的终点。 */
    const from = node.getBoundingClientRect().height

    node.style.setProperty('block-size', '0px')

    const { ceiling, floor } = bounds.current
    const target = Math.max(floor, Math.min(ceiling, node.scrollHeight))

    /* 布局值先落定，动画只负责这段路怎么走。 */
    node.style.setProperty('block-size', `${String(target)}px`)

    if (target === applied.current) {
      return
    }

    applied.current = target

    /* 位移是钳制之后的位移，也就是眼睛真的会看到的那一段。 */
    const delta = Math.abs(target - from)

    /* 第一次量的时候元素还没进过布局，那一下不该有入场动画。 */
    if (from === 0 || delta < 1 || STILLNESS?.matches === true) {
      return
    }

    running.current?.cancel()

    /*
     * 时长跟真实位移走，两头钳住：短了看不见，长了碍事。到顶之后继续粘字是零
     * 位移，于是零动画。曲线不过冲 —— 过冲会撞上钳位，把工具栏顶一下再弹回来。
     */
    running.current = node.animate(
      { blockSize: [`${String(from)}px`, `${String(target)}px`] },
      {
        duration: Math.min(400, Math.max(130, delta * 1.7)),
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'none',
      },
    )
  }, [])

  useLayoutEffect(() => {
    measure(text)
  }, [measure, text])

  /*
   * 宽度变了换行就变了，高度跟着变：拖动侧栏、缩放窗口都算。观察器会把这个
   * hook 自己写下的高度一起报回来，所以只在宽度真的变化时重量一次。
   */
  return useCallback(
    (node: HTMLTextAreaElement | null) => {
      held.current = node

      if (node === null || typeof ResizeObserver === 'undefined') {
        return undefined
      }

      let last = node.clientWidth

      const observer = new ResizeObserver(() => {
        const width = node.clientWidth

        if (width === last) {
          return
        }

        last = width
        measure(typed.current ?? '')
      })

      observer.observe(node)

      return () => {
        observer.disconnect()
        running.current?.cancel()
        running.current = null
        held.current = null
      }
    },
    [measure],
  )
}
