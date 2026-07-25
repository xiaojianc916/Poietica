import type { ReactNode } from 'react'

import type {
  WorkbenchTabId,
  WorkbenchTabViewModel,
  WorkbenchViewModel,
  WorkspacePanelRenderers,
  WorkspaceSurfaceId,
} from './public-api'

export interface CanvasPageViewModel {
  readonly id: string
  readonly title: string
  readonly isActive: boolean
}

export interface WorkspaceShellActions {
  readonly createCanvas: () => void
  readonly openCanvas: () => void
  readonly activateTab: (tabId: WorkbenchTabId) => void
  readonly closeTab: (tabId: WorkbenchTabId) => void
  readonly moveTab: (tabId: WorkbenchTabId, targetIndex: number) => void
  readonly openWorkspaceSurface: (surfaceId: WorkspaceSurfaceId, title: string) => void
  readonly activatePage: (pageId: string) => void
  readonly createPage: () => void
  readonly openCommandPalette: () => void
  readonly openDeveloperTools: () => void
  readonly openSettingsWindow: () => void
}

export interface WorkspaceChromeRenderProps {
  readonly isSidebarOpen: boolean
  readonly sidebarWidth: number
  readonly tabs: readonly WorkbenchTabViewModel[]
  readonly onSidebarToggle: () => void
  readonly onActivateTab: (tabId: WorkbenchTabId) => void
  readonly onCloseTab: (tabId: WorkbenchTabId) => void
  readonly onMoveTab: (tabId: WorkbenchTabId, targetIndex: number) => void
  readonly onCreateCanvas: () => void
}

export interface WorkspaceShellProps {
  readonly model: WorkbenchViewModel
  readonly actions: WorkspaceShellActions
  readonly pages: readonly CanvasPageViewModel[]
  readonly renderChrome: (props: WorkspaceChromeRenderProps) => ReactNode
  readonly mainContent: ReactNode
  readonly inspector: ReactNode
  /**
   * 仅表示右栏是否有实际可渲染内容。
   *
   * 不包含 selection、tool、styles 或 Shape 数据。
   */
  readonly inspectorAvailable: boolean
  readonly statusContent: ReactNode
  /**
   * 侧边栏面板体，由应用组合根注入。
   *
   * features/* 之间不得互相依赖，因此外壳只声明插槽，具体面板（如 AI 会话
   * 记录）由 apps/desktop 提供。
   */
  readonly panelRenderers?: WorkspacePanelRenderers
  readonly assistantOverlay?: ReactNode
  readonly overlays?: ReactNode
}
