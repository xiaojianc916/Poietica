import type { ReactNode } from 'react'

import type {
  WorkbenchTabId,
  WorkbenchTabViewModel,
  WorkbenchViewModel,
  WorkspaceSurfaceId,
} from './public-api'

export interface WorkspaceShellActions {
  readonly activateTab: (tabId: WorkbenchTabId) => void
  readonly closeTab: (tabId: WorkbenchTabId) => void
  readonly moveTab: (tabId: WorkbenchTabId, targetIndex: number) => void
  readonly openWorkspaceSurface: (surfaceId: WorkspaceSurfaceId, title: string) => void
  readonly openCommandPalette: () => void
  readonly openDeveloperTools: () => void
  readonly openSettingsWindow: () => void
}

export interface WorkspaceChromeRenderProps {
  readonly isSidebarOpen: boolean
  readonly tabs: readonly WorkbenchTabViewModel[]
  readonly onSidebarToggle: () => void
  readonly onActivateTab: (tabId: WorkbenchTabId) => void
  readonly onCloseTab: (tabId: WorkbenchTabId) => void
  readonly onMoveTab: (tabId: WorkbenchTabId, targetIndex: number) => void
  readonly onCreateConversation: () => void
}

export interface WorkspaceShellProps {
  readonly model: WorkbenchViewModel
  readonly actions: WorkspaceShellActions
  /**
   * 侧边栏下半部分的固定内容。
   *
   * 一个插槽，不是一张按 surface 索引的表：侧边栏的结构是固定的（上导航、
   * 下会话记录），导航项只在主区域打开表面。原先的 panelRenderers 是一张
   * 只有 ai 一个有效键的 map，点其余导航项就把侧边栏换成占位符。
   *
   * 具体面板由 apps 组合根注入，features/workspace 不依赖 features/ai。
   */
  readonly sidebarPanel: ReactNode
  /*
   * 替换侧边栏内容，但不改变它的列宽、拖拽与开合行为。
   *
   * 设置界面用它接管第 1 列：宽度来源仍然只有 workspaceLayoutStore，
   * 所以进出设置不会跳宽度，分隔条在设置界面里照样能拖。
   */
  /**
   * 侧边栏底部行左端的插槽。
   *
   * 与 sidebarOverride 互不相关：设置界面接管侧边栏时，底部行仍然是同一个
   * SidebarFooter，这个插槽因此在两种形态里都要在——否则进一趟设置，挂在那里
   * 的东西就凭空消失了。
   */
  readonly sidebarFooterSlot?: ReactNode
  readonly sidebarOverride?: ReactNode
  /*
   * 主区域不再是标签面板时的无障碍名称（例如设置界面）。
   *
   * 显式写出 undefined 是因为仓库开了 exactOptionalPropertyTypes：只写 ?: 时，
   * 组合根的三元表达式在工作台态传 undefined 会被判为类型错误，而“这个插槽
   * 在工作台态没有值”本来就是真实语义，契约直说比在 JSX 里做条件展开更清楚。
   */
  readonly mainContentLabel?: string | undefined
  readonly renderChrome: (props: WorkspaceChromeRenderProps) => ReactNode
  readonly mainContent: ReactNode
  /**
   * 浮于工作台之上的助手层，例如快捷唤起的对话浮窗。
   *
   * 与 sidebarPanel 是两个不同的插槽：这一个不占栅格列，不参与侧边栏布局。
   */
  readonly assistantOverlay?: ReactNode
  readonly overlays?: ReactNode
}
