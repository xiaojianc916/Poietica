import { type DragEvent, useCallback, useRef } from 'react'
import type { WorkbenchTabId, WorkbenchTabViewModel } from '../../../contracts/workbench-contract'
import { resolveWorkbenchTabDrop } from './workbench-tab-drag-model'

const WORKBENCH_TAB_MIME = 'application/x-hybrid-canvas-workbench-tab'

export interface UseWorkbenchTabDragOptions {
  readonly tabCount: number

  readonly onMove: (tabId: WorkbenchTabId, targetIndex: number) => void
}

export interface WorkbenchTabDragBindings {
  readonly onDragStart: (event: DragEvent<HTMLElement>, tab: WorkbenchTabViewModel) => void

  readonly onDragEnd: () => void

  readonly onDragOver: (event: DragEvent<HTMLElement>) => void

  readonly onDrop: (event: DragEvent<HTMLElement>, targetIndex: number) => void
}

export function useWorkbenchTabDrag({
  tabCount,
  onMove,
}: UseWorkbenchTabDragOptions): WorkbenchTabDragBindings {
  const draggedTabIdRef = useRef<WorkbenchTabId | null>(null)

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
        tabCount,
      })

      draggedTabIdRef.current = null

      if (!drop) {
        return
      }

      onMove(drop.tabId, drop.targetIndex)
    },
    [onMove, tabCount],
  )

  return {
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
  }
}
