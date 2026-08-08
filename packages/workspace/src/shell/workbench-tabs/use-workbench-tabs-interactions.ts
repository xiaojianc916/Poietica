import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { WorkbenchTabId, WorkbenchTabViewModel } from '../../workbench'
import {
  resolveWorkbenchTabCloseTarget,
  resolveWorkbenchTabDragLayout,
  resolveWorkbenchTabKeyboardAction,
  type WorkbenchTabDragLayout,
  type WorkbenchTabSlot,
} from './workbench-tabs-model'

/*
 * 重排是一次指针会话，不是 HTML5 拖放。拖放那套的缺陷不是调参能补的：落点只在标签本身
 * 生效（拖到新建按钮或标签条空白处松手一律无事发生），Escape 无法可靠取消，拖动过程拿
 * 不到连续坐标。
 *
 * 会话产出的是一份布局，不是一个插入提示：被拖的那一格跟着指针走，让位的每一格滑到自己
 * 的新位置。这是 Chrome 标签条的做法 —— Chromium 的 TabStrip 用 ideal bounds 加
 * BoundsAnimator 表达同一件事，而被拖的那个 tab 由 TabDragController 直接按指针定位、
 * 不走动画。
 *
 * 捕获在越过阈值时才建立，不在 pointerdown。捕获期间 mousedown 与 mouseup 都会被重定向到
 * 捕获元素，click 随之在承载会话的容器上派发，而它没有 onClick，于是标签内两个真正的按钮
 * （激活与关闭）会双双失灵。捕获的唯一用途是让拖动越过其它标签时事件仍回到源标签。
 */
const DRAG_THRESHOLD = 4

/**
 * 拖拽期间每一格的横向位移。
 *
 * 写在 DOM 上而不是 React state 上：这是会话内的瞬时视觉位置，不是领域状态；领域里的顺序
 * 只在松手时经 onMove 提交一次。逐帧过 state 会让整条标签条按帧重渲，而这个数的唯一消费者
 * 是 CSS 的 transform。
 */
const TAB_SHIFT_PROPERTY = '--chrome-tab-shift'

/** 激活标签的位移。基线缺口画在标签条根节点上，必须跟着激活标签一起走。 */
const ACTIVE_SHIFT_PROPERTY = '--chrome-active-tab-shift'

interface PendingCloseFocus {
  readonly closingTabId: WorkbenchTabId

  readonly fallbackTabId: WorkbenchTabId | null
}

interface ReorderSession {
  readonly pointerId: number

  readonly tabId: WorkbenchTabId

  readonly fromIndex: number

  readonly originX: number

  readonly element: HTMLElement

  active: boolean

  slots: readonly WorkbenchTabSlot[]

  elements: readonly HTMLElement[]

  activeIndex: number

  layout: WorkbenchTabDragLayout | null
}

export interface WorkbenchTabReorderBindings {
  readonly onPointerDown: (
    event: PointerEvent<HTMLElement>,
    tab: WorkbenchTabViewModel,
    index: number,
  ) => void

  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void

  readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void

  /**
   * 未越过阈值时指针移出标签：此时还没有捕获，松手的 pointerup 不会回到标签，会话必须在
   * 这里收尾，否则会残留并挡住下一次按压。
   */
  readonly onPointerLeave: (event: PointerEvent<HTMLElement>) => void

  readonly onPointerCancel: () => void

  readonly onLostPointerCapture: () => void
}

interface UseWorkbenchTabsInteractionsOptions {
  readonly tabs: readonly WorkbenchTabViewModel[]

  readonly onActivate: (tabId: WorkbenchTabId) => void

  readonly onClose: (tabId: WorkbenchTabId) => void

  readonly onMove: (tabId: WorkbenchTabId, targetIndex: number) => void

  readonly getTabElement: (tabId: WorkbenchTabId) => HTMLButtonElement | undefined

  readonly stripRef: RefObject<HTMLDivElement | null>

  readonly focusNewTab: () => void
}

export function useWorkbenchTabsInteractions({
  tabs,
  onActivate,
  onClose,
  onMove,
  getTabElement,
  stripRef,
  focusNewTab,
}: UseWorkbenchTabsInteractionsOptions) {
  const sessionRef = useRef<ReorderSession | null>(null)

  const pendingCloseFocusRef = useRef<PendingCloseFocus | null>(null)

  const [draggingTabId, setDraggingTabId] = useState<WorkbenchTabId | null>(null)

  const requestClose = useCallback(
    (tabId: WorkbenchTabId) => {
      const tab = tabs.find((candidate) => candidate.id === tabId)

      if (!tab?.canClose) {
        return
      }

      if (tab.isActive) {
        pendingCloseFocusRef.current = {
          closingTabId: tabId,
          fallbackTabId: resolveWorkbenchTabCloseTarget(tabs, tabId),
        }
      }

      onClose(tabId)
    },
    [onClose, tabs],
  )

  /*
   * 焦点跟随只在被关掉的标签确实消失之后才动：关闭是异步提交的，提前搬焦点会搬到一个
   * 马上要被卸载的节点上。
   */
  useEffect(() => {
    const pending = pendingCloseFocusRef.current

    if (!pending) {
      return
    }

    if (tabs.some((tab) => tab.id === pending.closingTabId)) {
      return
    }

    pendingCloseFocusRef.current = null

    const activeTab = tabs.find((tab) => tab.isActive)

    const fallbackTab = pending.fallbackTabId
      ? tabs.find((tab) => tab.id === pending.fallbackTabId)
      : undefined

    const target = activeTab ?? fallbackTab

    if (!target) {
      requestAnimationFrame(focusNewTab)

      return
    }

    if (!target.isActive) {
      onActivate(target.id)
    }

    requestAnimationFrame(() => {
      getTabElement(target.id)?.focus()
    })
  }, [focusNewTab, getTabElement, onActivate, tabs])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, tabId: WorkbenchTabId) => {
      const action = resolveWorkbenchTabKeyboardAction(tabs, tabId, event.key)

      if (!action) {
        return
      }

      event.preventDefault()

      if (action.type === 'close') {
        requestClose(action.tabId)

        return
      }

      onActivate(action.tabId)

      requestAnimationFrame(() => {
        getTabElement(action.tabId)?.focus()
      })
    },
    [getTabElement, onActivate, requestClose, tabs],
  )

  const endSession = useCallback(() => {
    const session = sessionRef.current

    if (!session) {
      return
    }

    if (session.element.hasPointerCapture(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId)
    }

    for (const element of session.elements) {
      element.style.removeProperty(TAB_SHIFT_PROPERTY)
    }

    stripRef.current?.style.removeProperty(ACTIVE_SHIFT_PROPERTY)

    sessionRef.current = null

    setDraggingTabId(null)
  }, [stripRef])

  /*
   * 收尾只有一条路径：松手、Escape、pointercancel、丢失捕获全走这里，区别只在要不要提交
   * 顺序。落位动画从"松手瞬间的视觉位置"补到"布局给出的位置"，取消与提交共用同一段代码，
   * 也就不会出现某条路径忘了收干净。
   */
  const concludeSession = useCallback(
    (commit: boolean) => {
      const session = sessionRef.current

      if (!session) {
        return
      }

      const { element, tabId, fromIndex, layout } = session

      if (!session.active || !layout || !element.isConnected) {
        endSession()

        return
      }

      const releasedLeft = element.getBoundingClientRect().left

      endSession()

      if (commit && layout.index !== fromIndex) {
        onMove(tabId, layout.index)
      }

      requestAnimationFrame(() => {
        const settled = getTabElement(tabId)?.closest<HTMLElement>('.chrome-workbench-tab')

        if (!settled) {
          return
        }

        settleIntoPlace(settled, releasedLeft - settled.getBoundingClientRect().left)
      })
    },
    [endSession, getTabElement, onMove],
  )

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>, tab: WorkbenchTabViewModel, index: number) => {
      if (event.button !== 0 || !tab.canClose || sessionRef.current) {
        return
      }

      sessionRef.current = {
        pointerId: event.pointerId,
        tabId: tab.id,
        fromIndex: index,
        originX: event.clientX,
        element: event.currentTarget,
        active: false,
        slots: [],
        elements: [],
        activeIndex: -1,
        layout: null,
      }
    },
    [],
  )

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const session = sessionRef.current

      if (!session || session.pointerId !== event.pointerId) {
        return
      }

      /*
       * 阈值以下不进入拖拽，普通点击仍然只是点击。越过阈值时把几何快照一次：一次拖拽内
       * 标签尺寸不变，逐帧重测只会白白触发同步布局。
       */
      if (!session.active) {
        if (Math.abs(event.clientX - session.originX) < DRAG_THRESHOLD) {
          return
        }

        const measured = measureStrip(tabs, getTabElement)

        if (!measured) {
          endSession()

          return
        }

        session.active = true
        session.slots = measured.slots
        session.elements = measured.elements
        session.activeIndex = tabs.findIndex((tab) => tab.isActive)

        session.element.setPointerCapture(session.pointerId)

        setDraggingTabId(session.tabId)
      }

      const layout = resolveWorkbenchTabDragLayout(
        session.slots,
        session.fromIndex,
        event.clientX - session.originX,
      )

      if (!layout) {
        return
      }

      session.layout = layout

      for (const [index, offset] of layout.offsets.entries()) {
        session.elements[index]?.style.setProperty(TAB_SHIFT_PROPERTY, `${String(offset)}px`)
      }

      const activeOffset = layout.offsets[session.activeIndex]

      if (activeOffset !== undefined) {
        stripRef.current?.style.setProperty(ACTIVE_SHIFT_PROPERTY, `${String(activeOffset)}px`)
      }
    },
    [endSession, getTabElement, stripRef, tabs],
  )

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (sessionRef.current?.pointerId !== event.pointerId) {
        return
      }

      concludeSession(true)
    },
    [concludeSession],
  )

  const onPointerLeave = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const session = sessionRef.current

      if (!session || session.pointerId !== event.pointerId || session.active) {
        return
      }

      endSession()
    },
    [endSession],
  )

  const cancelSession = useCallback(() => {
    concludeSession(false)
  }, [concludeSession])

  /*
   * Escape 只在会话活着时监听。键盘事件不会落到承载会话的容器上（焦点仍在内层按钮），
   * 所以必须挂 window。
   */
  useEffect(() => {
    if (!draggingTabId) {
      return
    }

    function onWindowKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') {
        cancelSession()
      }
    }

    window.addEventListener('keydown', onWindowKeyDown)

    return () => {
      window.removeEventListener('keydown', onWindowKeyDown)
    }
  }, [cancelSession, draggingTabId])

  const reorder: WorkbenchTabReorderBindings = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onPointerCancel: cancelSession,
    onLostPointerCapture: cancelSession,
  }

  return {
    requestClose,
    onKeyDown,
    reorder,
    draggingTabId,
  }
}

/*
 * 槽位与元素一次测齐。任一标签取不到元素就整体作废：索引必须与 tabs 一一对应，缺一个就会
 * 把位移写到别的标签上。宁可这次按压不进入拖拽，也不要错位。
 */
function measureStrip(
  tabs: readonly WorkbenchTabViewModel[],
  getTabElement: (tabId: WorkbenchTabId) => HTMLButtonElement | undefined,
): { slots: readonly WorkbenchTabSlot[]; elements: readonly HTMLElement[] } | null {
  const slots: WorkbenchTabSlot[] = []

  const elements: HTMLElement[] = []

  for (const tab of tabs) {
    const element = getTabElement(tab.id)?.closest<HTMLElement>('.chrome-workbench-tab')

    if (!element) {
      return null
    }

    const rect = element.getBoundingClientRect()

    slots.push({ id: tab.id, start: rect.left, end: rect.right })

    elements.push(element)
  }

  return elements.length > 0 ? { slots, elements } : null
}

/*
 * 松手后补一段落位：被拖的那一格从松手时的视觉位置滑到布局给它的位置，否则它会瞬移，前面
 * 一路跟手的物理感在最后一帧全部作废。让位的标签不需要这一段 —— 它们的位移取自静止槽位
 * 起点，松手后真实布局给出的就是它们已经在的位置。
 *
 * 用 Web Animations API 而不是再造一个 class 开关加 transitionend：一次性动画的起止与中断
 * 清理由平台负责。时长与曲线读设计令牌，和相邻标签的 CSS 过渡是同一组数；令牌读不到就不放
 * 动画，不在这里另写一个字面量当第二份真相。
 */
function settleIntoPlace(element: HTMLElement, delta: number): void {
  if (delta === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return
  }

  const styles = getComputedStyle(element)

  const duration = Number.parseFloat(styles.getPropertyValue('--ui-duration-fast'))

  const easing = styles.getPropertyValue('--ui-ease-standard').trim()

  if (!Number.isFinite(duration) || easing === '') {
    return
  }

  element.animate(
    [{ transform: `translateX(${String(delta)}px)` }, { transform: 'translateX(0)' }],
    { duration, easing },
  )
}
