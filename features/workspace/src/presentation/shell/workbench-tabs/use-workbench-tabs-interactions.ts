import { type DragEvent, type KeyboardEvent, useCallback, useEffect, useRef } from 'react'
import type { WorkbenchTabId, WorkbenchTabViewModel } from '../../../contracts/workbench-contract'
import {
  resolveWorkbenchTabCloseTarget,
  resolveWorkbenchTabDrop,
  resolveWorkbenchTabKeyboardAction,
} from './workbench-tabs-model'

const WORKBENCH_TAB_MIME = 'application/x-hybrid-canvas-workbench-tab'

interface PendingCloseFocus {
  readonly closingTabId: WorkbenchTabId

  readonly fallbackTabId: WorkbenchTabId | null
}

export interface WorkbenchTabDragBindings {
  readonly onDragStart: (event: DragEvent<HTMLElement>, tab: WorkbenchTabViewModel) => void

  readonly onDragEnd: () => void

  readonly onDragOver: (event: DragEvent<HTMLElement>) => void

  readonly onDrop: (event: DragEvent<HTMLElement>, targetIndex: number) => void
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
  const draggedTabIdRef = useRef<WorkbenchTabId | null>(null)

  const pendingCloseFocusRef = useRef<PendingCloseFocus | null>(null)

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

  const onDragStart = useCallback((event: DragEvent<HTMLElement>, tab: WorkbenchTabViewModel) => {
    if (!tab.canClose) {
      event.preventDefault()
      return
    }

    draggedTabIdRef.current = tab.id

    event.dataTransfer.effectAllowed = 'move'

    event.dataTransfer.setData(WORKBENCH_TAB_MIME, tab.id)
  }, [])

  const onDragEnd = useCallback(() => {
    draggedTabIdRef.current = null
  }, [])

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!draggedTabIdRef.current) {
      return
    }

    event.preventDefault()

    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>, targetIndex: number) => {
      event.preventDefault()

      const drop = resolveWorkbenchTabDrop({
        sessionTabId: draggedTabIdRef.current,

        transferredTabId: event.dataTransfer.getData(WORKBENCH_TAB_MIME),

        targetIndex,
        tabCount: tabs.length,
      })

      draggedTabIdRef.current = null

      if (!drop) {
        return
      }

      onMove(drop.tabId, drop.targetIndex)
    },
    [onMove, tabs.length],
  )

  const drag: WorkbenchTabDragBindings = {
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
  }

  return {
    requestClose,
    onKeyDown,
    drag,
  }
}
