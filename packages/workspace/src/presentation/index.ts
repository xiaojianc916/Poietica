export type { WorkspaceShellProps } from '../contracts/shell'

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

export {
  SidebarFooter,
  type SidebarFooterProps,
} from './shell/sidebar/SidebarFooter'
export { WorkspaceSidebar } from './shell/sidebar/WorkspaceSidebar'
export { WorkspaceShell } from './shell/WorkspaceShell'
export {
  WorkspaceSurface,
  type WorkspaceSurfaceProps,
} from './shell/WorkspaceSurface'
export {
  WorkbenchTabs,
  type WorkbenchTabsProps,
} from './shell/workbench-tabs/WorkbenchTabs'
export { WORKSPACE_LAYOUT } from './shell/workspace-layout'
export { useWorkspaceLayoutState, workspaceLayoutStore } from './shell/workspace-layout-store'
