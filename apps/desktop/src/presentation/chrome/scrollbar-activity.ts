/**
 * 浮层滚动条。
 *
 * 为什么自绘：原生滚动条无论走 `scrollbar-width` 还是 `::-webkit-scrollbar`，在
 * Windows 上都占据布局宽度，列表会因为它的出现与消失横向跳动；而且它的轨道长度恒等
 * 于滚动盒自身，画不到滚动盒之外。这两条都是引擎几何，CSS 里没有开关。所以滑块画在
 * 一层 fixed 浮层上：不占位、轨道可指定（`data-scrollbar-track`）、可按区域调参。
 *
 * 尺寸、时序、配色全部来自 CSS 自定义属性，并且从「滚动盒自身」读取。自定义属性会
 * 继承，未覆写的区域拿到的就是 :root 的值；某个区域要更粗或换色，只需在它自己的规则
 * 里覆写一行，不必回到这里改代码。
 */

const AXES = ['vertical', 'horizontal'] as const

type Axis = (typeof AXES)[number]

const LINGER_TOKEN = '--desktop-scrollbar-linger'
const FADE_TOKEN = '--desktop-scrollbar-fade'
const LANE_TOKEN = '--desktop-scrollbar-lane'
const THICKNESS_TOKEN = '--desktop-scrollbar-thickness'
const MIN_LENGTH_TOKEN = '--desktop-scrollbar-min-length'
const THUMB_TOKEN = '--desktop-scrollbar-thumb'
const THUMB_STRONG_TOKEN = '--desktop-scrollbar-thumb-strong'
const OPT_OUT_TOKEN = '--overlay-scrollbar'
const TRACK_ATTRIBUTE = '[data-scrollbar-track]'

interface Metrics {
  readonly linger: number
  readonly fade: number
  readonly lane: number
  readonly thickness: number
  readonly minLength: number
  readonly thumb: string
  readonly thumbStrong: string
}

interface Geometry {
  readonly main: number
  readonly cross: number
  readonly length: number
  readonly free: number
  readonly scrollable: number
}

interface Clip {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

interface Bar {
  readonly axis: Axis
  readonly scroller: Element
  readonly track: Element
  readonly element: HTMLDivElement
  readonly metrics: Metrics
  readonly clippers: readonly Element[]
  hideAt: number
  hovered: boolean
  dragging: boolean
  disposeAt: number | null
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high)

const readTime = (style: CSSStyleDeclaration, token: string, fallback: number): number => {
  const raw = style.getPropertyValue(token).trim()
  const value = Number.parseFloat(raw)

  if (!Number.isFinite(value)) {
    return fallback
  }

  return raw.endsWith('ms') ? value : value * 1000
}

const readLength = (style: CSSStyleDeclaration, token: string, fallback: number): number => {
  const value = Number.parseFloat(style.getPropertyValue(token))

  return Number.isFinite(value) ? value : fallback
}

const readColor = (style: CSSStyleDeclaration, token: string, fallback: string): string => {
  const raw = style.getPropertyValue(token).trim()

  return raw === '' ? fallback : raw
}

const readMetrics = (scroller: Element): Metrics => {
  const style = getComputedStyle(scroller)

  return {
    linger: readTime(style, LINGER_TOKEN, 1000),
    fade: readTime(style, FADE_TOKEN, 240),
    lane: readLength(style, LANE_TOKEN, 10),
    thickness: readLength(style, THICKNESS_TOKEN, 4),
    minLength: readLength(style, MIN_LENGTH_TOKEN, 28),
    thumb: readColor(style, THUMB_TOKEN, 'rgb(0 0 0 / 0.24)'),
    thumbStrong: readColor(style, THUMB_STRONG_TOKEN, 'rgb(0 0 0 / 0.36)'),
  }
}

/**
 * 某些盒子不要浮层滑块：标签条自己管溢出，思考过程用引擎自己的滚动条。两者都用同
 * 一行令牌退出，而不是靠选择器名单 —— 判定点因此只有一个，也就不会出现同一个盒子
 * 上两根滑块同时在动。
 *
 * 答案按元素缓存。reveal() 由 document 上的捕获型 scroll 监听调用，也就是每一个滚动
 * 事件都要问一次：一次滚轮手势几十个事件，每个都去解析一次计算样式。这个令牌来自
 * 静态规则，一个元素的答案不会中途改变，问一次就够。WeakMap 不拖住已被移除的节点。
 */
const optOut = new WeakMap<Element, boolean>()

const optedOut = (scroller: Element): boolean => {
  const known = optOut.get(scroller)

  if (known !== undefined) {
    return known
  }

  const answer = getComputedStyle(scroller).getPropertyValue(OPT_OUT_TOKEN).trim() === 'none'

  optOut.set(scroller, answer)

  return answer
}

/**
 * 一个元素自己是不是滚动容器。
 *
 * 轨道的归属只认这一个事实，不认类名、不认白名单：谁会滚，谁就自己画。
 */
const isScrollContainer = (element: Element): boolean => {
  const style = getComputedStyle(element)

  return (
    style.overflowY === 'auto' ||
    style.overflowY === 'scroll' ||
    style.overflowX === 'auto' ||
    style.overflowX === 'scroll'
  )
}

/**
 * 这根条画在哪条轨道上。
 *
 * 「面板声明自己是轨道，滑块就贯穿整块面板」这句话只对面板自己的滚动区成立。此前
 * 这里一路 closest 到最近的 data-scrollbar-track，中途有没有另一个滚动容器一概不
 * 问：代码块、思维链、工具输出一滚，滑块就被画到整条会话面板的右缘 —— 长度按面板
 * 算、位置按代码块算，于是「我在代码块里滑，外面那条也在动」。外层其实一步没滚，
 * 动的是一根本来就不该在那里的滑块。
 *
 * 所以往上找有终点：命中轨道标记才领走它，而在此之前遇到的第一个滚动容器就说明这
 * 条轨道不属于自己 —— 就地返回滚动盒，画在自己的边缘上。
 */
const trackOf = (scroller: Element): Element => {
  let node: Element | null = scroller

  while (node !== null) {
    if (node.matches(TRACK_ATTRIBUTE)) {
      return node
    }

    if (node !== scroller && isScrollContainer(node)) {
      return scroller
    }

    node = node.parentElement
  }

  return scroller
}

const scrollableOn = (scroller: Element, axis: Axis): boolean =>
  axis === 'vertical'
    ? scroller.scrollHeight - scroller.clientHeight > 1
    : scroller.scrollWidth - scroller.clientWidth > 1

/** 建条时走一次祖先链；每帧只对这些元素取矩形，不再重复读样式。 */
const clippersOf = (element: Element): readonly Element[] => {
  const found: Element[] = []
  let node = element.parentElement

  while (node !== null && node !== document.body) {
    const style = getComputedStyle(node)
    const clips =
      style.overflowX !== 'visible' ||
      style.overflowY !== 'visible' ||
      style.contain.includes('paint') ||
      style.contain.includes('strict')

    if (clips) {
      found.push(node)
    }

    node = node.parentElement
  }

  return found
}

const clipOf = (clippers: readonly Element[]): Clip | null => {
  if (clippers.length === 0) {
    return null
  }

  let top = Number.NEGATIVE_INFINITY
  let left = Number.NEGATIVE_INFINITY
  let right = Number.POSITIVE_INFINITY
  let bottom = Number.POSITIVE_INFINITY

  for (const clipper of clippers) {
    const box = clipper.getBoundingClientRect()

    top = Math.max(top, box.top)
    left = Math.max(left, box.left)
    right = Math.min(right, box.right)
    bottom = Math.min(bottom, box.bottom)
  }

  return { top, right, bottom, left }
}

const measure = (
  scroller: Element,
  track: Element,
  axis: Axis,
  metrics: Metrics,
): Geometry | null => {
  const vertical = axis === 'vertical'
  const content = vertical ? scroller.scrollHeight : scroller.scrollWidth
  const viewport = vertical ? scroller.clientHeight : scroller.clientWidth
  const scrollable = content - viewport

  if (scrollable <= 1) {
    return null
  }

  const box = track.getBoundingClientRect()
  const trackMain = vertical ? box.height : box.width
  const length = Math.max(metrics.minLength, Math.round((trackMain * viewport) / content))
  const free = Math.max(trackMain - length, 0)
  const offset = vertical ? scroller.scrollTop : scroller.scrollLeft
  const progress = clamp(offset / scrollable, 0, 1)
  const lane = (vertical ? box.right : box.bottom) - metrics.lane

  return {
    main: (vertical ? box.top : box.left) + free * progress,
    cross: lane + (metrics.lane - metrics.thickness) / 2,
    length,
    free,
    scrollable,
  }
}

const place = (bar: Bar): void => {
  const geometry = measure(bar.scroller, bar.track, bar.axis, bar.metrics)

  if (geometry === null) {
    bar.element.dataset['visible'] = 'false'

    return
  }

  const vertical = bar.axis === 'vertical'
  const clip = clipOf(bar.clippers)
  let start = geometry.main
  let length = geometry.length

  if (clip !== null) {
    const low = vertical ? clip.top : clip.left
    const high = vertical ? clip.bottom : clip.right
    const crossLow = vertical ? clip.left : clip.top
    const crossHigh = vertical ? clip.right : clip.bottom
    const end = Math.min(start + length, high)

    start = Math.max(start, low)
    length = end - start

    const outside =
      length <= 0 || geometry.cross + bar.metrics.thickness < crossLow || geometry.cross > crossHigh

    if (outside) {
      bar.element.dataset['visible'] = 'false'

      return
    }
  }

  const style = bar.element.style

  style.setProperty(vertical ? 'top' : 'left', `${String(Math.round(start))}px`)
  style.setProperty(vertical ? 'left' : 'top', `${String(Math.round(geometry.cross))}px`)
  style.setProperty(vertical ? 'height' : 'width', `${String(Math.round(length))}px`)
}

/**
 * 单根条在这一帧的处置：还活着，还是已经收掉了。
 *
 * 与遍历分开，是因为这是两件事：一件是"这根条现在该怎样"，一件是"谁还需要下一
 * 帧"。揉在一个函数里，光是嵌套就把认知复杂度顶到 25；分开之后各自只有一层。
 */
const advance = (bar: Bar, now: number): 'alive' | 'gone' => {
  if (bar.disposeAt !== null) {
    if (now < bar.disposeAt) {
      return 'alive'
    }

    bar.element.remove()

    return 'gone'
  }

  place(bar)

  if (bar.dragging || bar.hovered) {
    bar.hideAt = now + bar.metrics.linger

    return 'alive'
  }

  if (now >= bar.hideAt) {
    bar.element.dataset['visible'] = 'false'
    bar.disposeAt = now + bar.metrics.fade
  }

  return 'alive'
}

export function installScrollbarActivity(): () => void {
  const layer = document.createElement('div')

  layer.className = 'overlay-scrollbar-layer'
  document.body.append(layer)

  const bars = new Map<Element, Map<Axis, Bar>>()
  let frame: number | null = null

  const schedule = (): void => {
    if (frame === null) {
      frame = requestAnimationFrame(tick)
    }
  }

  function tick(): void {
    frame = null

    const now = performance.now()
    let alive = false

    for (const [scroller, axes] of bars) {
      for (const [axis, bar] of axes) {
        if (advance(bar, now) === 'gone') {
          axes.delete(axis)

          continue
        }

        alive = true
      }

      if (axes.size === 0) {
        bars.delete(scroller)
      }
    }

    if (alive) {
      frame = requestAnimationFrame(tick)
    }
  }

  const createBar = (scroller: Element, axis: Axis): Bar => {
    const metrics = readMetrics(scroller)
    const track = trackOf(scroller)
    const element = document.createElement('div')

    element.className = 'overlay-scrollbar'
    element.dataset['axis'] = axis
    element.dataset['visible'] = 'false'
    element.style.setProperty(THUMB_TOKEN, metrics.thumb)
    element.style.setProperty(THUMB_STRONG_TOKEN, metrics.thumbStrong)
    element.style.setProperty(
      axis === 'vertical' ? 'width' : 'height',
      `${String(metrics.thickness)}px`,
    )

    const bar: Bar = {
      axis,
      scroller,
      track,
      element,
      metrics,
      clippers: clippersOf(track),
      hideAt: 0,
      hovered: false,
      dragging: false,
      disposeAt: null,
    }

    element.addEventListener('pointerenter', () => {
      bar.hovered = true
      schedule()
    })

    element.addEventListener('pointerleave', () => {
      bar.hovered = false
      schedule()
    })

    element.addEventListener('pointerdown', (event: PointerEvent) => {
      const geometry = measure(scroller, track, axis, metrics)

      if (geometry === null) {
        return
      }

      const vertical = axis === 'vertical'
      const origin = vertical ? event.clientY : event.clientX
      const offset = vertical ? scroller.scrollTop : scroller.scrollLeft

      bar.dragging = true
      element.dataset['dragging'] = 'true'
      element.setPointerCapture(event.pointerId)

      const onMove = (move: PointerEvent): void => {
        const current = measure(scroller, track, axis, metrics)

        if (current === null || current.free <= 0) {
          return
        }

        const delta = (vertical ? move.clientY : move.clientX) - origin
        const next = clamp(
          offset + (delta / current.free) * current.scrollable,
          0,
          current.scrollable,
        )

        if (vertical) {
          scroller.scrollTop = next
        } else {
          scroller.scrollLeft = next
        }
      }

      const onRelease = (): void => {
        bar.dragging = false
        element.removeAttribute('data-dragging')
        element.removeEventListener('pointermove', onMove)
        element.removeEventListener('pointerup', onRelease)
        element.removeEventListener('pointercancel', onRelease)
        schedule()
      }

      element.addEventListener('pointermove', onMove)
      element.addEventListener('pointerup', onRelease)
      element.addEventListener('pointercancel', onRelease)
      event.preventDefault()
    })

    layer.append(element)
    requestAnimationFrame(() => {
      element.dataset['visible'] = 'true'
    })

    return bar
  }

  const reveal = (scroller: Element): void => {
    if (optedOut(scroller)) {
      return
    }

    for (const axis of AXES) {
      if (!scrollableOn(scroller, axis)) {
        continue
      }

      const axes = bars.get(scroller) ?? new Map<Axis, Bar>()

      bars.set(scroller, axes)

      const existing = axes.get(axis)
      const bar = existing ?? createBar(scroller, axis)

      if (existing === undefined) {
        axes.set(axis, bar)
      }

      bar.disposeAt = null
      bar.hideAt = performance.now() + bar.metrics.linger
      bar.element.dataset['visible'] = 'true'
      place(bar)
    }

    schedule()
  }

  const onScroll = (event: Event): void => {
    const target = event.target

    if (target instanceof Element) {
      reveal(target)

      return
    }

    if (target instanceof Document && target.scrollingElement !== null) {
      reveal(target.scrollingElement)
    }
  }

  document.addEventListener('scroll', onScroll, { capture: true, passive: true })

  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true })

    if (frame !== null) {
      cancelAnimationFrame(frame)
    }

    layer.remove()
    bars.clear()
  }
}
