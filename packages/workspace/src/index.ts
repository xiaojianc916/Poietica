/*
 * 包的公开面。显式罗列而不是 export *：
 * 此前靠 biome-ignore-all 压掉 noReExportAll，被压掉的规则说的正是
 * 「谁在用什么」从此看不见——那不是误报。
 */
export type {
  RegisteredCommand,
  UICommand,
  UICommandHandler,
} from './command-contract'
export { type CommandRegistry, createCommandRegistry } from './command-registry'
export {
  CommandPalette,
  type CommandPaletteProps,
} from './commands/command-palette'
export {
  CommandProvider,
  type CommandProviderProps,
  useCommands,
} from './commands/command-provider'
export { formatKeybinding, useCommandKeybindings } from './commands/keybinding'
export type {
  WorkspacePart,
  WorkspacePartId,
  WorkspaceParts,
} from './parts'
export {
  type PersistedWorkbenchState,
  PersistedWorkbenchStateSchema,
  type WorkbenchStatePort,
} from './persistence'
export {
  SidebarFooter,
  type SidebarFooterProps,
} from './shell/sidebar/sidebar-footer'
export { WorkspaceSidebar } from './shell/sidebar/workspace-sidebar'
export {
  useWorkspaceLayoutMode,
  type WorkspaceLayoutMode,
} from './shell/use-workspace-layout'
export {
  WorkbenchTabs,
  type WorkbenchTabsProps,
} from './shell/workbench-tabs/workbench-tabs'
export { WORKSPACE_LAYOUT } from './shell/workspace-layout'
export { useWorkspaceLayoutState, workspaceLayoutStore } from './shell/workspace-layout-store'
export { WorkspaceShell } from './shell/workspace-shell'
export {
  WorkspaceSurface,
  type WorkspaceSurfaceProps,
} from './shell/workspace-surface'
export type { WorkspaceShellActions, WorkspaceShellProps } from './shell-contract'
export type { WorkspaceSurfaceRenderers } from './surface'
export {
  DEFAULT_SURFACE_ID,
  describeWorkspaceSurface,
  isWorkspaceSurfaceId,
  WORKSPACE_NAVIGATION_ORDER,
  WORKSPACE_SURFACE_REGISTRY,
  type WorkspaceSurfaceDescriptor,
} from './surface-registry'
export {
  type ActiveConversationViewModel,
  CONVERSATION_ENTRY_TITLE,
  type ConversationId,
  type ConversationTabViewModel,
  DEFAULT_SURFACE_TAB_ID,
  emptyWorkbenchViewModel,
  type OpenConversationRequest,
  type OpenWorkspaceSurfaceRequest,
  type WorkbenchSessionCommands,
  type WorkbenchSessionStore,
  type WorkbenchSurfaceViewModel,
  type WorkbenchTabId,
  type WorkbenchTabViewModel,
  type WorkbenchViewModel,
  type WorkspaceSurfaceId,
  type WorkspaceSurfaceViewModel,
  type WorkspaceTabViewModel,
} from './workbench'
export { createWorkbenchSessionController } from './workbench-session-controller'
