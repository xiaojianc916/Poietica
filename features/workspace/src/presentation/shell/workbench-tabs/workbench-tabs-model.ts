import type { WorkbenchTabId } from '../../../contracts/workbench-contract'

export interface WorkbenchTabModelItem {
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

export interface WorkbenchTabDropInput {
  readonly sessionTabId: WorkbenchTabId | null

  readonly transferredTabId: string

  readonly targetIndex: number

  readonly tabCount: number
}

export interface WorkbenchTabDrop {
  readonly tabId: WorkbenchTabId

  readonly targetIndex: number
}

export function resolveWorkbenchTabKeyboardAction(
  tabs: readonly WorkbenchTabModelItem[],
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

export function resolveWorkbenchTabCloseTarget(
  tabs: readonly WorkbenchTabModelItem[],
  closingTabId: WorkbenchTabId,
): WorkbenchTabId | null {
  const closingIndex = tabs.findIndex((tab) => tab.id === closingTabId)

  if (closingIndex < 0 || tabs.length <= 1) {
    return null
  }

  return tabs[closingIndex + 1]?.id ?? tabs[closingIndex - 1]?.id ?? null
}

export function resolveWorkbenchTabDrop({
  sessionTabId,
  transferredTabId,
  targetIndex,
  tabCount,
}: WorkbenchTabDropInput): WorkbenchTabDrop | null {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= tabCount) {
    return null
  }

  const tabId = sessionTabId ?? normalizeTransferredTabId(transferredTabId)

  if (!tabId) {
    return null
  }

  return {
    tabId,
    targetIndex,
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

function normalizeTransferredTabId(value: string): WorkbenchTabId | null {
  const normalized = value.trim()

  if (normalized.length === 0) {
    return null
  }

  return normalized as WorkbenchTabId
}
