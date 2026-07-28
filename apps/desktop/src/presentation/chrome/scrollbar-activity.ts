/*
 * 浮层滚动条:自己画,因为原生滚动条画不出"不占位"。
 *
 * 为什么不能继续用原生。Chromium 的经典滚动条是布局的一部分,它从滚动盒的
 * 内容区里切走 10px —— 同一个列表,内容少时占满、内容一多滚动条出现,整列
 * 文字就左移 10px。面向网页的 overlay-scrollbar 开关早已下线,
 * ::-webkit-scrollbar 画出来的东西一定占位,所以"浮在内容之上"原生做不到。
 *
 * 自绘不等于重做交互。这里只画一根滑块,尺寸、圆角、颜色、停留与淡出时长
 * 全部沿用 app.css 里那几个令牌,观感与上一版逐像素一致;变的只是它不再从
 * 内容里拿走宽度。顺带补回原生本来就有的两件事:滑块可以拖,指针停在滑块上
 * 时它不会消失 —— 否则那个悬停加深色永远没有机会被看到。
 *
 * 仍然是"装一次,全窗口一致"。scroll 不冒泡,但捕获阶段在 document 上收得到
 * 任意滚动盒的 scroll,event.target 就是那个盒子;组件不需要记得接上什么,
 * 也不会因为忘了接而没有滚动条。
 *
 * 滑块画在 body 末尾一张 fixed 的浮层里,而不是插进滚动盒内部:插进去要求
 * 每一个滚动盒都成为定位祖先,那才会改到别人的布局。代价是浮层不受祖先的
 * overflow 裁剪,所以几何这一步自己算了一遍裁剪链(clippersOf / clipOf),
 * 嵌套的滚动盒滚出可视区时滑块跟着截断。
 *
 * 颜色不写死在这里。滑块创建时从它所属的滚动盒上读 --desktop-scrollbar-thumb
 * 与 -thumb-strong,于是"某个区域要更浅的滚动条"仍然是在那个区域的 CSS 里给
 * 令牌赋值 —— 尽管滑块的 DOM 节点并不在那棵子树里。
 *
 * 只在有滑块可见时才跑 rAF:位置每帧重算,所以滚动盒被移动、被 resize、内容
 * 长度变化都不需要各自的观察者。没有滑块时一帧都不跑。
 */

const LINGER_TOKEN = '--desktop-scrollbar-linger'
const FADE_TOKEN = '--desktop-scrollbar-fade'
const LANE_TOKEN = '--desktop-scrollbar-lane'
const THICKNESS_TOKEN = '--desktop-scrollbar-thickness'
const MIN_LENGTH_TOKEN = '--desktop-scrollbar-min-length'
const OPT_OUT_TOKEN = '--overlay-scrollbar'
const THUMB_TOKEN = '--desktop-scrollbar-thumb'
const THUMB_STRONG_TOKEN = '--desktop-scrollbar-thumb-strong'

const AXES = ['vertical', 'horizontal'] as const

type Axis = (typeof AXES)[number]

interface Metrics {
  readonly linger: number
  readonly fade: number
  readonly lane: number
  readonly thickness: number
  readonly minLength: number
}

interface Geometry {
  /** 滑块起点,视口坐标,主轴。 */
  readonly start: number
  readonly length: number
  /** 滑块在交叉轴上的位置。 */
  readonly cross: number
  /** 滚动余量与轨道余量之比,拖拽时把指针位移换算成滚动量。 */
  readonly ratio: number
}

interface Clip {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

interface Bar {
  readonly element: HTMLElement
  readonly clippers: readonly Element[]
  readonly release: () => void
  hideAt: number
  dragging: boolean
}

/** 令牌读不到就用兜底值,滚动条不会因为一个拼错的变量名而消失。 */
function readNumber(style: CSSStyleDeclaration, token: string, fallback: number): number {
  const value = Number.parseFloat(style.getPropertyValue(token))

  return Number.isFinite(value) && value > 0 ? value : fallback
}

function readMetrics(): Metrics {
  const style = getComputedStyle(document.documentElement)

  return {
    fade: readNumber(style, FADE_TOKEN, 240),
    lane: readNumber(style, LANE_TOKEN, 10),
    linger: readNumber(style, LINGER_TOKEN, 1000),
    minLength: readNumber(style, MIN_LENGTH_TOKEN, 28),
    thickness: readNumber(style, THICKNESS_TOKEN, 4),
  }
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/*
 * 谁会裁剪这个滚动盒。
 *
 * 只在建滑块时走一遍祖先链:overflow 与 contain 极少在运行时变,而每帧对十几个
 * 祖先取计算样式会把样式重算拖进滚动路径。每帧要读的只是它们的矩形。
 */
function clippersOf(scroller: Element): readonly Element[] {
  const clippers: Element[] = []

  for (let node = scroller.parentElement; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node)
    const clipsOverflow = style.overflowX !== 'visible' || style.overflowY !== 'visible'
    const clipsPaint = style.contain.includes('paint') || style.contain.includes('strict')

    if (clipsOverflow || clipsPaint) {
      clippers.push(node)
    }
  }

  return clippers
}

function clipOf(clippers: readonly Element[]): Clip {
  let top = 0
  let left = 0
  let right = window.innerWidth
  let bottom = window.innerHeight

  for (const clipper of clippers) {
    const rect = clipper.getBoundingClientRect()

    top = Math.max(top, rect.top)
    left = Math.max(left, rect.left)
    right = Math.min(right, rect.right)
    bottom = Math.min(bottom, rect.bottom)
  }

  return { bottom, left, right, top }
}

/*
 * 滑块的几何。
 *
 * 边框宽度从 clientTop / clientLeft 取,所以起点算的是 padding box 而不是
 * border box —— 有边框的滚动盒(代码块)不会因此偏一个像素。主轴两端各留
 * (lane - thickness) / 2,与原生那圈 3px 透明边收出来的形状相同。
 */
function measure(scroller: Element, axis: Axis, metrics: Metrics): Geometry | null {
  const vertical = axis === 'vertical'
  const viewport = vertical ? scroller.clientHeight : scroller.clientWidth
  const content = vertical ? scroller.scrollHeight : scroller.scrollWidth
  const scrollable = content - viewport

  if (viewport <= 0 || scrollable <= 1) {
    return null
  }

  const rect = scroller.getBoundingClientRect()
  const pad = (metrics.lane - metrics.thickness) / 2
  const raw = Math.max(metrics.minLength, Math.round((viewport * viewport) / content))
  const free = Math.max(viewport - raw, 0)
  const position = vertical ? scroller.scrollTop : scroller.scrollLeft
  const progress = clamp(position / scrollable, 0, 1)
  const originMain = vertical ? rect.top + scroller.clientTop : rect.left + scroller.clientLeft
  const originCross = vertical ? rect.left + scroller.clientLeft : rect.top + scroller.clientTop
  const crossSize = vertical ? scroller.clientWidth : scroller.clientHeight

  return {
    cross: originCross + crossSize - pad - metrics.thickness,
    length: Math.max(raw - pad * 2, metrics.thickness),
    ratio: free <= 0 ? 0 : scrollable / free,
    start: originMain + free * progress + pad,
  }
}

/** 摆好滑块。返回 false 表示这条轴此刻不该有滑块。 */
function place(scroller: Element, axis: Axis, bar: Bar, metrics: Metrics): boolean {
  const geometry = measure(scroller, axis, metrics)

  if (geometry === null) {
    return false
  }

  const clip = clipOf(bar.clippers)
  const vertical = axis === 'vertical'
  const lowBound = vertical ? clip.top : clip.left
  const highBound = vertical ? clip.bottom : clip.right
  const crossLow = vertical ? clip.left : clip.top
  const crossHigh = vertical ? clip.right : clip.bottom
  const start = Math.max(geometry.start, lowBound)
  const end = Math.min(geometry.start + geometry.length, highBound)

  if (end - start < 1 || geometry.cross + metrics.thickness <= crossLow) {
    return false
  }

  if (geometry.cross >= crossHigh) {
    return false
  }

  const style = bar.element.style
  const main = `${String(Math.round(start))}px`
  const size = `${String(Math.round(end - start))}px`
  const cross = `${String(Math.round(geometry.cross))}px`
  const thickness = `${String(metrics.thickness)}px`

  if (vertical) {
    style.top = main
    style.height = size
    style.left = cross
    style.width = thickness
  } else {
    style.left = main
    style.width = size
    style.top = cross
    style.height = thickness
  }

  return true
}

/** 装上浮层滚动条。返回卸载函数,供测试使用。 */
export function installScrollbarActivity(): () => void {
  const metrics = readMetrics()
  const layer = document.createElement('div')

  layer.className = 'overlay-scrollbar-layer'
  layer.setAttribute('aria-hidden', 'true')
  document.body.append(layer)

  const bars = new Map<Element, Map<Axis, Bar>>()
  const optOut = new WeakMap<Element, boolean>()
  let frame = 0

  /* 退出与否是外观决定,写在 CSS 里;每个滚动盒只问一次。 */
  const optedOut = (scroller: Element): boolean => {
    const known = optOut.get(scroller)

    if (known !== undefined) {
      return known
    }

    const declared = getComputedStyle(scroller).getPropertyValue(OPT_OUT_TOKEN).trim() === 'none'

    optOut.set(scroller, declared)

    return declared
  }

  const createBar = (scroller: Element, axis: Axis): Bar => {
    const element = document.createElement('div')

    element.className = 'overlay-scrollbar'
    element.dataset['axis'] = axis

    /* 颜色跟着滚动盒所在的区域走,尽管滑块本身挂在浮层里。 */
    const inherited = getComputedStyle(scroller)

    element.style.setProperty(THUMB_TOKEN, inherited.getPropertyValue(THUMB_TOKEN))
    element.style.setProperty(THUMB_STRONG_TOKEN, inherited.getPropertyValue(THUMB_STRONG_TOKEN))

    let origin = 0
    let originScroll = 0

    const onPointerDown = (event: PointerEvent) => {
      /* 按住滑块不应该选中底下的文字。 */
      event.preventDefault()
      element.setPointerCapture(event.pointerId)
      bar.dragging = true
      element.dataset['dragging'] = 'true'
      origin = axis === 'vertical' ? event.clientY : event.clientX
      originScroll = axis === 'vertical' ? scroller.scrollTop : scroller.scrollLeft
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!bar.dragging) {
        return
      }

      const geometry = measure(scroller, axis, metrics)

      if (geometry === null) {
        return
      }

      const travel = (axis === 'vertical' ? event.clientY : event.clientX) - origin
      const next = originScroll + travel * geometry.ratio

      if (axis === 'vertical') {
        scroller.scrollTop = next
      } else {
        scroller.scrollLeft = next
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!bar.dragging) {
        return
      }

      bar.dragging = false
      delete element.dataset['dragging']
      element.releasePointerCapture(event.pointerId)
      bar.hideAt = performance.now() + metrics.linger
    }

    const bar: Bar = {
      clippers: clippersOf(scroller),
      dragging: false,
      element,
      hideAt: 0,
      release: () => {
        element.removeEventListener('pointerdown', onPointerDown)
        element.removeEventListener('pointermove', onPointerMove)
        element.removeEventListener('pointerup', onPointerUp)
        element.removeEventListener('pointercancel', onPointerUp)
      },
    }

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('pointercancel', onPointerUp)
    layer.append(element)

    /* 起始态与终止态落在同一帧就没有过渡可言,所以下一帧才置为可见。 */
    requestAnimationFrame(() => {
      element.dataset['visible'] = 'true'
    })

    return bar
  }

  const dispose = (scroller: Element, axis: Axis, bar: Bar) => {
    const axes = bars.get(scroller)

    axes?.delete(axis)

    if (axes !== undefined && axes.size === 0) {
      bars.delete(scroller)
    }

    bar.release()
    bar.element.dataset['visible'] = 'false'
    window.setTimeout(() => {
      bar.element.remove()
    }, metrics.fade)
  }

  const tick = () => {
    const now = performance.now()

    for (const [scroller, axes] of [...bars]) {
      for (const [axis, bar] of [...axes]) {
        const alive = scroller.isConnected && place(scroller, axis, bar, metrics)
        /* 指针停在滑块上时不倒计时,否则悬停色永远来不及被看见。 */
        const held = bar.dragging || bar.element.matches(':hover')

        if (!alive || (!held && now >= bar.hideAt)) {
          dispose(scroller, axis, bar)
        }
      }
    }

    frame = bars.size === 0 ? 0 : requestAnimationFrame(tick)
  }

  const reveal = (scroller: Element) => {
    for (const axis of AXES) {
      if (measure(scroller, axis, metrics) === null) {
        continue
      }

      const axes = bars.get(scroller) ?? new Map<Axis, Bar>()
      const existing = axes.get(axis)
      const bar = existing ?? createBar(scroller, axis)

      bar.hideAt = performance.now() + metrics.linger
      axes.set(axis, bar)
      bars.set(scroller, axes)
      place(scroller, axis, bar, metrics)
    }

    if (frame === 0 && bars.size > 0) {
      frame = requestAnimationFrame(tick)
    }
  }

  const onScroll = (event: Event) => {
    const scroller = event.target

    if (scroller instanceof Element && !optedOut(scroller)) {
      reveal(scroller)
    }
  }

  document.addEventListener('scroll', onScroll, { capture: true, passive: true })

  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true })

    if (frame !== 0) {
      cancelAnimationFrame(frame)
      frame = 0
    }

    for (const axes of bars.values()) {
      for (const bar of axes.values()) {
        bar.release()
      }
    }

    bars.clear()
    layer.remove()
  }
}
