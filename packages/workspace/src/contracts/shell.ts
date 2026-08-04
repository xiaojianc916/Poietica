import type { WorkspaceParts } from './parts'
import type { WorkbenchTabId, WorkbenchViewModel, WorkspaceSurfaceId } from './workbench'

export interface WorkspaceShellActions {
  readonly activateTab: (tabId: WorkbenchTabId) => void
  readonly closeTab: (tabId: WorkbenchTabId) => void
  readonly moveTab: (tabId: WorkbenchTabId, targetIndex: number) => void
  /** 只收 id，标题由 registry 查。 */
  readonly openWorkspaceSurface: (surfaceId: WorkspaceSurfaceId) => void
  readonly openCommandPalette: () => void
  readonly openDeveloperTools: () => void
  readonly openSettingsWindow: () => void
}

/**
 * 工作台外壳的输入。
 *
 * 只有三样东西：一份投影、一组动作、一张 Part 表。此前这里有 sidebarPanel、
 * sidebarFooterSlot、sidebarOverride、assistantOverlay、overlays 五个 ReactNode
 * 通道加一个 renderChrome render prop —— 每加一个区域就多一个 prop，
 * 布局职责被推给组合根做 props drilling。
 */
export interface WorkspaceShellProps {
  readonly model: WorkbenchViewModel
  readonly actions: WorkspaceShellActions
  readonly parts: WorkspaceParts
}
