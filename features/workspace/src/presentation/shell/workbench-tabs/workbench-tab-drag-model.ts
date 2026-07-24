import type { WorkbenchTabId } from '../../../contracts/workbench-contract'

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

function normalizeTransferredTabId(value: string): WorkbenchTabId | null {
  const normalized = value.trim()

  if (normalized.length === 0) {
    return null
  }

  return normalized as WorkbenchTabId
}
