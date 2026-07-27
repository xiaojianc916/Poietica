export type { WorkspaceShellProps } from '../contracts/shell-contract'

export {
  CommandPalette,
  type CommandPaletteProps,
} from './commands/CommandPalette'
export {
  CommandProvider,
  type CommandProviderProps,
  useCommands,
} from './commands/CommandProvider'
export { formatKeybinding, useCommandKeybindings } from './commands/keybinding'

export { NoCanvasSurface } from './empty/NoCanvasSurface'

export { InspectorHost } from './inspector/InspectorHost'

export {
  SidebarFooter,
  type SidebarFooterProps,
} from './shell/SidebarFooter'
export { nextUntitledCanvasTitle } from './shell/untitled-canvas-title'
export { WORKSPACE_LAYOUT } from './shell/workspace-layout'
export {
  WorkbenchTabs,
  type WorkbenchTabsProps,
} from './shell/WorkbenchTabs'
export { WorkspaceShell } from './shell/WorkspaceShell'
export { WorkspaceSidebar } from './shell/WorkspaceSidebar'
export {
  WorkspaceSurface,
  type WorkspaceSurfaceProps,
} from './shell/WorkspaceSurface'
export { useWorkspaceLayoutState, workspaceLayoutStore } from './shell/workspace-layout-store'
export { StatusBarHost } from './status/StatusBarHost'
