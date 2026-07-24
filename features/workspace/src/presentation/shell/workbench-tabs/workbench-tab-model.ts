import type { WorkbenchTabId } from '../../../contracts/workbench-contract'

export interface WorkbenchTabNavigationItem {
  readonly id: WorkbenchTabId
  readonly canClose: boolean
}

export type WorkbenchTabKeyboardAction =
  | {
      readonly type: 'activate'
      readonly tabId: WorkbenchTabId
    }
  | {
      readonly type: 'close'
      readonly tabId: WorkbenchTabId
    }

export function resolveWorkbenchTabKeyboardAction(
  tabs: readonly WorkbenchTabNavigationItem[],
  currentTabId: WorkbenchTabId,
  key: string,
): WorkbenchTabKeyboardAction | null {
  const currentIndex = tabs.findIndex((tab) => tab.id === currentTabId)

  if (currentIndex < 0 || tabs.length === 0) {
    return null
  }

  if (key === 'Delete') {
    const currentTab = tabs[currentIndex]

    if (!currentTab?.canClose) {
      return null
    }

    return {
      type: 'close',
      tabId: currentTab.id,
    }
  }

  const targetIndex = resolveTargetIndex(key, currentIndex, tabs.length)

  if (targetIndex === null) {
    return null
  }

  const target = tabs[targetIndex]

  if (!target) {
    return null
  }

  return {
    type: 'activate',
    tabId: target.id,
  }
}

export function encodeWorkbenchTabDomId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, '-')
}

function resolveTargetIndex(key: string, currentIndex: number, tabCount: number): number | null {
  switch (key) {
    case 'ArrowLeft':
      return (currentIndex - 1 + tabCount) % tabCount

    case 'ArrowRight':
      return (currentIndex + 1) % tabCount

    case 'Home':
      return 0

    case 'End':
      return tabCount - 1

    default:
      return null
  }
}
