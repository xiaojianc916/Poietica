import {
  type RefObject,
  type WheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'
import type { WorkbenchTabId } from '../../../contracts/workbench-contract'

const VIEWPORT_PADDING = 4

interface UseWorkbenchTabsViewportOptions {
  readonly activeTabId: WorkbenchTabId | undefined

  readonly layoutKey: string
}

interface WorkbenchTabsViewport {
  readonly scrollerRef: RefObject<HTMLDivElement | null>

  readonly viewportRef: RefObject<HTMLDivElement | null>

  readonly getTabElement: (tabId: WorkbenchTabId) => HTMLButtonElement | undefined

  readonly registerTab: (tabId: WorkbenchTabId, element: HTMLButtonElement | null) => void

  readonly onWheel: (event: WheelEvent<HTMLDivElement>) => void
}

export function useWorkbenchTabsViewport({
  activeTabId,
  layoutKey,
}: UseWorkbenchTabsViewportOptions): WorkbenchTabsViewport {
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const viewportRef = useRef<HTMLDivElement | null>(null)

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

    if (tabStart < viewportStart + VIEWPORT_PADDING) {
      nextScrollLeft = Math.max(0, tabStart - VIEWPORT_PADDING)
    } else if (tabEnd > viewportEnd - VIEWPORT_PADDING) {
      nextScrollLeft = tabEnd - scroller.clientWidth + VIEWPORT_PADDING
    }

    if (nextScrollLeft !== viewportStart) {
      scroller.scrollTo({
        left: nextScrollLeft,
        behavior: 'auto',
      })
    }
  }, [activeTabId, layoutKey])

  useLayoutEffect(() => {
    const viewport = viewportRef.current

    const scroller = scrollerRef.current

    if (!viewport || !scroller) {
      return
    }

    const syncBaselineGap = () => {
      if (!activeTabId) {
        clearBaselineGap(viewport)

        return
      }

      const activation = tabRefs.current.get(activeTabId)

      const activeTab = activation?.closest<HTMLElement>('.chrome-workbench-tab')

      if (!activeTab) {
        clearBaselineGap(viewport)

        return
      }

      const viewportRect = viewport.getBoundingClientRect()

      const tabRect = activeTab.getBoundingClientRect()

      const left = Math.max(0, tabRect.left - viewportRect.left)

      const right = Math.min(viewportRect.width, tabRect.right - viewportRect.left)

      viewport.dataset['hasActiveTab'] = 'true'

      viewport.style.setProperty('--chrome-active-tab-left', String(left) + 'px')

      viewport.style.setProperty('--chrome-active-tab-right', String(right) + 'px')
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
     * Scroll events may fire several times in one frame. Geometry reads are
     * coalesced so getBoundingClientRect cannot force repeated layout work
     * within the same display frame.
     */
    scheduleBaselineGapSync()

    scroller.addEventListener('scroll', scheduleBaselineGapSync, {
      passive: true,
    })

    /*
     * Observe the elements whose geometry actually affects the baseline gap.
     * This is more precise than subscribing every tab strip to global window
     * resize events.
     */
    const resizeObserver = new ResizeObserver(scheduleBaselineGapSync)

    resizeObserver.observe(viewport)
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
  }, [activeTabId, layoutKey])

  const onWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current

    if (!scroller || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return
    }

    scroller.scrollLeft += event.deltaY
  }, [])

  return {
    scrollerRef,
    viewportRef,
    getTabElement,
    registerTab,
    onWheel,
  }
}

function clearBaselineGap(viewport: HTMLDivElement): void {
  viewport.dataset['hasActiveTab'] = 'false'

  viewport.style.removeProperty('--chrome-active-tab-left')

  viewport.style.removeProperty('--chrome-active-tab-right')
}
