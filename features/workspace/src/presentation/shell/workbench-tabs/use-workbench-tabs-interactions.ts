import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { WorkbenchTabId, WorkbenchTabViewModel } from '../../../contracts/workbench-contract'
import {
  resolveWorkbenchTabCloseTarget,
  resolveWorkbenchTabInsertion,
  resolveWorkbenchTabKeyboardAction,
  type WorkbenchTabInsertion,
  type WorkbenchTabSlot,
} from './workbench-tabs-model'

/*
 * 重排是一次指针会话，不是 HTML5 拖放。
 *
 * 拖放那套的三个缺陷都不是调参能补的：落点只在标签本身生效（拖到新建按钮、
 * 尾部填充区或标签条空白处松手一律无事发生），拖动过程没有插入位置提示，
 * Escape 无法可靠取消。专业标签条一律用指针捕获 + 实时指示器。
 *
 * 这里与侧边栏缩放同一范式：setPointerCapture 拿到整段指针序列，几何在越过
 * 阈值时快照一次，插入位置由纯函数从指针坐标算出，Escape / pointercancel /
 * lostpointercapture 三条路径统一收尾。
 *
 * 捕获在越过阈值时才建立，不在 pointerdown。捕获期间 Chromium 会把 mousedown 与
 * mouseup 一并重定向到捕获元素，click 随之在承载会话的容器上派发——它没有
 * onClick，于是标签内两个真正的按钮（激活与关闭）会双双失灵。捕获的唯一用途是
 * 让拖动越过其它标签时事件仍回到源标签，阈值之前并不需要它。这也是 VS Code 与
 * Chrome 的拖拽实现方式。
 */
const DRAG_THRESHOLD = 4

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

  target: WorkbenchTabInsertion | null
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
   * 未越过阈值时指针移出标签：此时还没有捕获，松手的 pointerup 不会回到标签，
   * 会话必须在这里收尾，否则会残留并挡住下一次按压。
   */
  readonly onPointerLeave: (event: PointerEvent<HTMLElement>) => void

  readonly onPointerCancel: () => void

  readonly onLostPointerCapture: () => void
}

export interface WorkbenchTabReorderState {
  readonly draggingTabId: WorkbenchTabId | null

  readonly insertion: WorkbenchTabInsertion | null
}

const IDLE_REORDER: WorkbenchTabReorderState = {
  draggingTabId: null,
  insertion: null,
}

interface UseWorkbenchTabsInteractionsOptions {
  readonly tabs: readonly WorkbenchTabViewModel[]

  readonly onActivate: (tabId: WorkbenchTabId) => void

  readonly onClose: (tabId: WorkbenchTabId) => void

  readonly onMove: (tabId: WorkbenchTabId, targetIndex: number) => void

  readonly getTabElement: (tabId: WorkbenchTabId) => HTMLButtonElement | undefined

  readonly focusNewTab: () => void
}

export function useWorkbenchTabsInteractions({
  tabs,
  onActivate,
  onClose,
  onMove,
  getTabElement,
  focusNewTab,
}: UseWorkbenchTabsInteractionsOptions) {
  const sessionRef = useRef<ReorderSession | null>(null)

  const slotsRef = useRef<readonly WorkbenchTabSlot[]>([])

  const pendingCloseFocusRef = useRef<PendingCloseFocus | null>(null)

  const [reorderState, setReorderState] = useState<WorkbenchTabReorderState>(IDLE_REORDER)

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

  useEffect(() => {
    const pending = pendingCloseFocusRef.current

    if (!pending) {
      return
    }

    const closingTabStillExists = tabs.some((tab) => tab.id === pending.closingTabId)

    if (closingTabStillExists) {
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

    if (session?.element.hasPointerCapture(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId)
    }

    sessionRef.current = null

    slotsRef.current = []

    setReorderState(IDLE_REORDER)
  }, [])

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>, tab: WorkbenchTabViewModel, index: number) => {
      if (event.button !== 0 || !tab.canClose || sessionRef.current) {
        return
      }

      const element = event.currentTarget

      sessionRef.current = {
        pointerId: event.pointerId,
        tabId: tab.id,
        fromIndex: index,
        originX: event.clientX,
        element,
        active: false,
        target: null,
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
       * 阈值以下不进入拖拽，普通点击仍然只是点击。越过阈值时快照几何：标签在
       * 一次拖拽内不会改变尺寸，每帧重测只会白白触发布局。
       */
      if (!session.active) {
        if (Math.abs(event.clientX - session.originX) < DRAG_THRESHOLD) {
          return
        }

        session.active = true

        session.element.setPointerCapture(session.pointerId)

        slotsRef.current = measureSlots(tabs, getTabElement)
      }

      session.target = resolveWorkbenchTabInsertion(
        slotsRef.current,
        session.fromIndex,
        event.clientX,
      )

      const next: WorkbenchTabReorderState = {
        draggingTabId: session.tabId,
        insertion: session.target,
      }

      setReorderState((previous) =>
        previous.draggingTabId === next.draggingTabId &&
        previous.insertion?.targetId === next.insertion?.targetId &&
        previous.insertion?.side === next.insertion?.side
          ? previous
          : next,
      )
    },
    [getTabElement, tabs],
  )

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const session = sessionRef.current

      if (!session || session.pointerId !== event.pointerId) {
        return
      }

      const target = session.active ? session.target : null

      const tabId = session.tabId

      endSession()

      if (target) {
        onMove(tabId, target.index)
      }
    },
    [endSession, onMove],
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

  useEffect(() => {
    if (!reorderState.draggingTabId) {
      return
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key !== 'Escape') {
        return
      }

      const session = sessionRef.current

      if (session) {
        session.target = null
      }

      endSession()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [endSession, reorderState.draggingTabId])

  const reorder: WorkbenchTabReorderBindings = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onPointerCancel: endSession,
    onLostPointerCapture: endSession,
  }

  return {
    requestClose,
    onKeyDown,
    reorder,
    reorderState,
  }
}

function measureSlots(
  tabs: readonly WorkbenchTabViewModel[],
  getTabElement: (tabId: WorkbenchTabId) => HTMLButtonElement | undefined,
): readonly WorkbenchTabSlot[] {
  const slots: WorkbenchTabSlot[] = []

  for (const tab of tabs) {
    const element = getTabElement(tab.id)?.closest<HTMLElement>('.chrome-workbench-tab')

    if (!element) {
      continue
    }

    const rect = element.getBoundingClientRect()

    slots.push({
      id: tab.id,
      start: rect.left,
      end: rect.right,
    })
  }

  /*
   * 槽位索引必须与 tabs 索引一一对应，否则算出来的目标位置会指向别的标签。
   * 缺任何一个就整体作废，宁可这次拖拽不生效。
   */
  return slots.length === tabs.length ? slots : []
}
