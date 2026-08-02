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
 *
 * 时序是到期唤醒的，不是每帧轮询的。此前 tick() 的续帧条件是「还有没有条」，于是一
 * 次滚轮之后还要空转 linger + fade（默认 1240ms，约七十几帧），每一帧都对滚动盒读
 * scrollHeight/clientHeight、对轨道与每一个祖先裁剪盒各取一次矩形，然后把逐字相同的
 * 位置再写一遍；而 hovered 会让 hideAt 每帧续期 —— 鼠标停在滑块上，那个循环永远不会
 * 结束。现在几何只在有理由变化时读：滚动事件、或者 ResizeObserver 说盒子变了。其余
 * 时间一个布局量都不读，一个定时器等着该消失的那一刻。agent-ui 的相对时间也是这套
 * 管线，不是这里新发明的第二套。
 *
 * 位置写 transform，长度只在真的变了时写。top/height 是布局属性，在 rAF 里写、下一帧
 * 又在 rAF 里读，就是一次自造的读写交错；而滚动过程中滑块长度根本不变 —— 内容尺寸没
 * 动，它凭什么动。
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

/** 上一次真的写进 DOM 的那三个数。相同就不写。 */
interface Placement {
  readonly x: number
  readonly y: number
  readonly length: number
}

interface Bar {
  readonly axis: Axis
  readonly scroller: Element
  readonly track: Element
  readonly element: HTMLDivElement
  readonly metrics: Metrics
  readonly clippers: readonly Element[]
  readonly observer: ResizeObserver
  placed: Placement | null
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
 * 答案按元素缓存：这个令牌来自静态规则，一个元素的答案不会中途改变，问一次就够。
 * WeakMap 不拖住已被移除的节点。而这次询问现在发生在帧里而不是事件里 —— 滚动事件
 * 处理器一个计算样式都不解析。
 */
const optOut = new WeakMap<Element, boolean>()

const optedOut = (scroller: Element): boolean => {
  const known = optOut.get(scroller)

  if (known !== undefined) {
    return known
  }

  /*
   * 单行输入框不是一片可以浏览的内容。
   *
   * scroll 监听挂在 document 的捕获阶段，所以它接住的是页面上任何元素的滚动 ——
   * 包括 <input>。往密钥框里粘一段长文本，插入符跳到末尾，浏览器为此派发一个
   * scroll 事件，这里就认领它、量出 scrollWidth > clientWidth、在框底画出一根
   * 横条，停留 linger 再淡出 fade —— 一秒二百四十毫秒之后自己消失。那就是「粘
   * 贴之后底部闪一下」的全部经过。
   *
   * 输入框的横向位移是插入符跟随光标，不是阅读位置：没有人会去拖那根条来读一
   * 段密钥。而这层浮层存在的理由（见文件顶上）是原生条在 Windows 上占布局宽度、
   * 让列表横向跳动 —— 输入框根本不在那个场景里。
   *
   * 判定写在这里而不是给某个类加一行退出令牌：令牌是给「这一片区域另有安排」用
   * 的，而这是一整类元素的性质。按类名一个个加，下一个输入框还会再中一次。
   *
   * textarea 不在此列：多行编辑区的纵向滚动是真的在浏览内容。
   */
  if (scroller instanceof HTMLInputElement) {
    optOut.set(scroller, true)

    return true
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
 * 「面板声明自己是轨道，滑块就贯穿整块面板」这句话只对面板自己的滚动区成立。往上
 * 找因此有终点：命中轨道标记才领走它，而在此之前遇到的第一个滚动容器就说明这条轨
 * 道不属于自己 —— 就地返回滚动盒，画在自己的边缘上。
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

/** 建条时走一次祖先链；之后只对这些元素取矩形，不再重复读样式。 */
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

const conceal = (bar: Bar): void => {
  bar.element.dataset['visible'] = 'false'
}

/**
 * 把这一帧的几何写进 DOM —— 如果它真的和上一次不同。
 *
 * 位置走 transform：它只经过合成，而 top/left 每次都要重新布局这层浮层。长度仍是
 * height/width，但只在变了时写 —— 滚动过程中内容尺寸没动，滑块长度就不会动，此前
 * 却每帧照写一遍。
 */
const place = (bar: Bar): void => {
  const geometry = measure(bar.scroller, bar.track, bar.axis, bar.metrics)

  if (geometry === null) {
    conceal(bar)

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
      conceal(bar)

      return
    }
  }

  const main = Math.round(start)
  const cross = Math.round(geometry.cross)
  const size = Math.round(length)
  const x = vertical ? cross : main
  const y = vertical ? main : cross
  const placed = bar.placed

  if (placed !== null && placed.x === x && placed.y === y && placed.length === size) {
    return
  }

  const style = bar.element.style

  if (placed === null || placed.length !== size) {
    style.setProperty(vertical ? 'height' : 'width', `${String(size)}px`)
  }

  style.transform = `translate3d(${String(x)}px, ${String(y)}px, 0)`
  bar.placed = { x, y, length: size }
}

/**
 * 单根条在这一帧的处置：还活着，还是已经收掉了。
 *
 * 几何只在这一帧被判为脏的时候才读。悬停与拖拽期间 hideAt 是正无穷 —— 不到期，
 * 也就不需要任何人守着它到期；此前那是靠每帧把它往后推实现的，代价是一个永远
 * 不会停的循环。
 */
const advance = (bar: Bar, now: number, dirty: boolean): 'alive' | 'gone' => {
  if (bar.disposeAt !== null) {
    if (now < bar.disposeAt) {
      return 'alive'
    }

    bar.observer.disconnect()
    bar.element.remove()

    return 'gone'
  }

  if (dirty) {
    place(bar)
  }

  if (bar.hovered || bar.dragging) {
    return 'alive'
  }

  if (now >= bar.hideAt) {
    conceal(bar)
    bar.disposeAt = now + bar.metrics.fade
  }

  return 'alive'
}

export function installScrollbarActivity(): () => void {
  const layer = document.createElement('div')

  layer.className = 'overlay-scrollbar-layer'
  document.body.append(layer)

  const bars = new Map<Element, Map<Axis, Bar>>()

  /*
   * 滚动事件只往这里记一笔。
   *
   * 处理器里一个布局量都不读、一个计算样式都不解析：一次滚轮手势几十上百个事件，
   * 它们描述的是同一帧的同一份几何，读一次就够。这与 AgentActivityFeed 的
   * scheduleSync 是同一条规矩。
   */
  const touched = new Set<Element>()

  /** 这一帧有没有理由重算几何。 */
  let dirty = false
  let frame: number | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const schedule = (): void => {
    if (frame === null) {
      frame = requestAnimationFrame(tick)
    }
  }

  /** 盒子自己变了 —— 面板被拖窄、内容长高 —— 而这不产生滚动事件。 */
  const onResize = (): void => {
    dirty = true
    schedule()
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

    /* 位置的唯一来源是 transform，所以两条边先归零，不让样式表参与定位。 */
    element.style.top = '0'
    element.style.left = '0'

    const observer = new ResizeObserver(onResize)

    observer.observe(scroller)

    if (track !== scroller) {
      observer.observe(track)
    }

    const bar: Bar = {
      axis,
      scroller,
      track,
      element,
      metrics,
      clippers: clippersOf(track),
      observer,
      placed: null,
      hideAt: 0,
      hovered: false,
      dragging: false,
      disposeAt: null,
    }

    element.addEventListener('pointerenter', () => {
      bar.hovered = true
      bar.hideAt = Number.POSITIVE_INFINITY
      schedule()
    })

    element.addEventListener('pointerleave', () => {
      bar.hovered = false
      bar.hideAt = performance.now() + bar.metrics.linger
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
      bar.hideAt = Number.POSITIVE_INFINITY
      element.dataset['dragging'] = 'true'
      element.setPointerCapture(event.pointerId)

      /*
       * 拖拽不需要自己的循环：把 scrollTop 写下去就会有一个滚动事件回来，那条路
       * 已经会把这一帧标脏。
       */
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
        bar.hideAt = performance.now() + bar.metrics.linger
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

    /* 进场那一次淡入要跨一帧，否则元素刚插入就已经是终态，过渡不会跑。 */
    requestAnimationFrame(() => {
      element.dataset['visible'] = 'true'
    })

    return bar
  }

  /** 认领一个刚滚动过的盒子：该建的建，该续期的续期。几何交给这一帧统一读。 */
  const adopt = (scroller: Element, now: number): void => {
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

      if (existing === undefined) {
        axes.set(axis, createBar(scroller, axis))

        continue
      }

      existing.disposeAt = null

      if (!existing.hovered && !existing.dragging) {
        existing.hideAt = now + existing.metrics.linger
      }

      existing.element.dataset['visible'] = 'true'
    }
  }

  /*
   * 一帧一次，然后就地睡着。
   *
   * 这一帧结束时若还有条要在将来某一刻消隐，就按最近的那个时刻排一个定时器，而不
   * 是继续排下一帧 —— 那段时间里几何不会变，读它读不出新答案。悬停与拖拽期间到期
   * 时刻是正无穷，于是连定时器都不排。
   */
  function tick(): void {
    frame = null

    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }

    const now = performance.now()

    for (const scroller of touched) {
      adopt(scroller, now)
    }

    touched.clear()

    const sweeping = dirty

    dirty = false

    let wakeAt = Number.POSITIVE_INFINITY

    for (const [scroller, axes] of bars) {
      for (const [axis, bar] of axes) {
        if (advance(bar, now, sweeping || bar.placed === null) === 'gone') {
          axes.delete(axis)

          continue
        }

        const due = bar.disposeAt ?? bar.hideAt

        if (due < wakeAt) {
          wakeAt = due
        }
      }

      if (axes.size === 0) {
        bars.delete(scroller)
      }
    }

    if (wakeAt !== Number.POSITIVE_INFINITY) {
      timer = setTimeout(tick, Math.max(0, wakeAt - now))
    }
  }

  const onScroll = (event: Event): void => {
    const target = event.target
    const scroller =
      target instanceof Element
        ? target
        : target instanceof Document
          ? target.scrollingElement
          : null

    if (scroller === null) {
      return
    }

    touched.add(scroller)
    dirty = true
    schedule()
  }

  document.addEventListener('scroll', onScroll, { capture: true, passive: true })

  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true })

    if (frame !== null) {
      cancelAnimationFrame(frame)
    }

    if (timer !== null) {
      clearTimeout(timer)
    }

    for (const axes of bars.values()) {
      for (const bar of axes.values()) {
        bar.observer.disconnect()
      }
    }

    layer.remove()
    bars.clear()
    touched.clear()
  }
}
