import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type WheelEvent,
} from 'react'
import type { WorkbenchTabId } from '../../../contracts/workbench'

const SCROLL_EDGE_PADDING = 4

interface UseWorkbenchTabsViewportOptions {
  readonly activeTabId: WorkbenchTabId | undefined

  readonly tabsGeometryKey: string
}

interface WorkbenchTabsViewport {
  readonly scrollerRef: RefObject<HTMLDivElement | null>

  /**
   * 标签条根元素。基线分隔线画在它上面，因为只有它横跨整条标签条——滚动容器
   * 已经不再横跨（新建按钮与拖拽填充区是它的兄弟节点）。
   */
  readonly stripRef: RefObject<HTMLDivElement | null>

  readonly getTabElement: (tabId: WorkbenchTabId) => HTMLButtonElement | undefined

  readonly registerTab: (tabId: WorkbenchTabId, element: HTMLButtonElement | null) => void

  readonly onWheel: (event: WheelEvent<HTMLDivElement>) => void
}

export function useWorkbenchTabsViewport({
  activeTabId,
  tabsGeometryKey,
}: UseWorkbenchTabsViewportOptions): WorkbenchTabsViewport {
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const stripRef = useRef<HTMLDivElement | null>(null)

  const tabRefs = useRef(new Map<WorkbenchTabId, HTMLButtonElement>())

  const previousActiveTabIdRef = useRef<WorkbenchTabId | undefined>(activeTabId)

  const getTabElement = useCallback((tabId: WorkbenchTabId) => {
    return tabRefs.current.get(tabId)
  }, [])

  const registerTab = useCallback((tabId: WorkbenchTabId, element: HTMLButtonElement | null) => {
    if (element) {
      tabRefs.current.set(tabId, element)

      return
    }

    tabRefs.current.delete(tabId)
  }, [])

  useEffect(() => {
    const previousActiveTabId = previousActiveTabIdRef.current

    if (previousActiveTabId && previousActiveTabId !== activeTabId) {
      const previousActivation = tabRefs.current.get(previousActiveTabId)

      const previousTab = previousActivation?.closest<HTMLElement>('.chrome-workbench-tab')

      if (previousTab?.matches(':hover')) {
        previousTab.setAttribute('data-suppress-hover', 'true')
      }
    }

    if (activeTabId) {
      const activeActivation = tabRefs.current.get(activeTabId)

      activeActivation
        ?.closest<HTMLElement>('.chrome-workbench-tab')
        ?.removeAttribute('data-suppress-hover')
    }

    previousActiveTabIdRef.current = activeTabId
  }, [activeTabId])

  /*
   * tabsGeometryKey 是变更信号，不是本 effect 读取的值：标签集合或任一标题变化
   * 都会改变标签宽度，激活标签可能因此被推出可视区，需要重新滚动对齐。
   *
   * Biome 把 hook 参数当作外层作用域值，所以把它报成多余依赖；同一个数组里的
   * activeTabId 来源完全相同却没有被报，区别只在于它在 effect 体内被读取过。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: 删除会让激活标签在标签改名后停留在可视区外
  useEffect(() => {
    if (!activeTabId) {
      return
    }

    const scroller = scrollerRef.current

    const activation = tabRefs.current.get(activeTabId)

    const tab = activation?.closest<HTMLElement>('.chrome-workbench-tab')

    if (!scroller || !tab) {
      return
    }

    const viewportStart = scroller.scrollLeft

    const viewportEnd = viewportStart + scroller.clientWidth

    const tabStart = tab.offsetLeft

    const tabEnd = tabStart + tab.offsetWidth

    let nextScrollLeft = viewportStart

    if (tabStart < viewportStart + SCROLL_EDGE_PADDING) {
      nextScrollLeft = Math.max(0, tabStart - SCROLL_EDGE_PADDING)
    } else if (tabEnd > viewportEnd - SCROLL_EDGE_PADDING) {
      nextScrollLeft = tabEnd - scroller.clientWidth + SCROLL_EDGE_PADDING
    }

    if (nextScrollLeft !== viewportStart) {
      scroller.scrollTo({
        left: nextScrollLeft,
        behavior: 'auto',
      })
    }
  }, [activeTabId, tabsGeometryKey])

  /*
   * 同上。ResizeObserver 无法替代这个信号：重命名排在激活标签之前的标签，会让
   * 激活标签整体位移而不改变任何被观察盒子的尺寸，ResizeObserver 对纯位移不
   * 触发，平台也没有位置观察器。这个摘要是目前唯一能感知位移的信号。
   *
   * 这里只写两个自定义属性，不再改 data-has-active-tab：那个属性由 JSX 声明式
   * 持有，两处写入判据不同（这里还要求元素已注册），会长期停在互相矛盾的值上。
   * 属性缺失时根块的 0px 默认值渲染出的正是"无活动标签"的整条基线。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: 删除会让激活标签的基线间隙自定义属性失同步
  useLayoutEffect(() => {
    const strip = stripRef.current

    const scroller = scrollerRef.current

    if (!strip || !scroller) {
      return
    }

    const syncBaselineGap = () => {
      const activation = activeTabId ? tabRefs.current.get(activeTabId) : undefined

      const activeTab = activation?.closest<HTMLElement>('.chrome-workbench-tab')

      if (!activeTab) {
        clearBaselineGap(strip)

        return
      }

      const stripRect = strip.getBoundingClientRect()

      const tabRect = activeTab.getBoundingClientRect()

      const left = Math.max(0, tabRect.left - stripRect.left)

      const right = Math.min(stripRect.width, tabRect.right - stripRect.left)

      strip.style.setProperty('--chrome-active-tab-left', `${String(left)}px`)

      strip.style.setProperty('--chrome-active-tab-right', `${String(right)}px`)
    }

    let measureFrame: number | null = null

    const scheduleBaselineGapSync = () => {
      if (measureFrame !== null) {
        return
      }

      measureFrame = requestAnimationFrame(() => {
        measureFrame = null
        syncBaselineGap()
      })
    }

    /*
     * 一帧内可能触发多次滚动事件，几何读取合并到一帧里做，避免同一帧内反复
     * 强制布局。
     */
    scheduleBaselineGapSync()

    scroller.addEventListener('scroll', scheduleBaselineGapSync, {
      passive: true,
    })

    /*
     * 只观察真正影响基线间隙的盒子：标签条根、滚动容器、当前激活标签。比让每个
     * 标签条都去订阅 window resize 精确得多。
     */
    const resizeObserver = new ResizeObserver(scheduleBaselineGapSync)

    resizeObserver.observe(strip)
    resizeObserver.observe(scroller)

    const activeActivation = activeTabId ? tabRefs.current.get(activeTabId) : undefined

    const activeTab = activeActivation?.closest<HTMLElement>('.chrome-workbench-tab')

    if (activeTab) {
      resizeObserver.observe(activeTab)
    }

    return () => {
      scroller.removeEventListener('scroll', scheduleBaselineGapSync)

      resizeObserver.disconnect()

      if (measureFrame !== null) {
        cancelAnimationFrame(measureFrame)
      }
    }
  }, [activeTabId, tabsGeometryKey])

  const onWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current

    if (!scroller || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return
    }

    scroller.scrollLeft += event.deltaY
  }, [])

  return {
    scrollerRef,
    stripRef,
    getTabElement,
    registerTab,
    onWheel,
  }
}

function clearBaselineGap(strip: HTMLDivElement): void {
  strip.style.removeProperty('--chrome-active-tab-left')

  strip.style.removeProperty('--chrome-active-tab-right')
}
