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
} from './shell/SidebarFooter'

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
export { WORKSPACE_LAYOUT } from './shell/workspace-layout'
export { useWorkspaceLayoutState, workspaceLayoutStore } from './shell/workspace-layout-store'
