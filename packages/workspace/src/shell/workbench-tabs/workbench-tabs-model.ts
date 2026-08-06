import type { WorkbenchTabId } from '../../workbench'

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

/** 一个标签在标签条上占据的横向区间，拖拽开始时快照一次。 */
export interface WorkbenchTabSlot {
  readonly id: WorkbenchTabId

  readonly start: number

  readonly end: number
}

export interface WorkbenchTabInsertion {
  /** 指示器画在哪个标签的哪一侧。 */
  readonly targetId: WorkbenchTabId

  readonly side: 'before' | 'after'

  /** 结果列表中的目标位置，与 onMove 的既有契约一致。 */
  readonly index: number
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

/*
 * 指针落在哪两个标签之间，由各标签中线决定；越过最后一条中线就是排到末尾。
 * 指针不必落在某个标签上——这正是 HTML5 拖放做不到的那一点。
 */
export function resolveWorkbenchTabInsertion(
  slots: readonly WorkbenchTabSlot[],
  fromIndex: number,
  pointerX: number,
): WorkbenchTabInsertion | null {
  if (slots.length === 0 || fromIndex < 0 || fromIndex >= slots.length) {
    return null
  }

  let insertBefore = slots.length

  for (const [index, slot] of slots.entries()) {
    if (pointerX < (slot.start + slot.end) / 2) {
      insertBefore = index

      break
    }
  }

  const index = insertBefore > fromIndex ? insertBefore - 1 : insertBefore

  if (index === fromIndex) {
    return null
  }

  const target = slots[index]

  if (!target) {
    return null
  }

  return {
    targetId: target.id,
    side: index > fromIndex ? 'after' : 'before',
    index,
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
