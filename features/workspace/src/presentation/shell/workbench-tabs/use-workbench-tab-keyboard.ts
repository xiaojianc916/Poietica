import { type KeyboardEvent, useCallback } from 'react'
import type { WorkbenchTabId, WorkbenchTabViewModel } from '../../../contracts/workbench-contract'
import { resolveWorkbenchTabKeyboardAction } from './workbench-tab-model'

export interface UseWorkbenchTabKeyboardOptions {
  readonly tabs: readonly WorkbenchTabViewModel[]

  readonly onActivate: (tabId: WorkbenchTabId) => void

  readonly onClose: (tabId: WorkbenchTabId) => void

  readonly getTabElement: (tabId: WorkbenchTabId) => HTMLButtonElement | null | undefined
}

export function useWorkbenchTabKeyboard({
  tabs,
  onActivate,
  onClose,
  getTabElement,
}: UseWorkbenchTabKeyboardOptions) {
  return useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, tabId: WorkbenchTabId): void => {
      const action = resolveWorkbenchTabKeyboardAction(tabs, tabId, event.key)

      if (!action) {
        return
      }

      event.preventDefault()

      if (action.type === 'close') {
        onClose(action.tabId)

        return
      }

      onActivate(action.tabId)

      requestAnimationFrame(() => {
        getTabElement(action.tabId)?.focus()
      })
    },
    [getTabElement, onActivate, onClose, tabs],
  )
}
