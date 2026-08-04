/*
 * 包的公开面。显式罗列而不是 export *：
 * 此前靠 biome-ignore-all 压掉 noReExportAll，被压掉的规则说的正是
 * 「谁在用什么」从此看不见——那不是误报。
 */
export type {
  WorkspacePart,
  WorkspacePartId,
  WorkspaceParts,
} from './contracts/parts'
export {
  type PersistedWorkbenchState,
  PersistedWorkbenchStateSchema,
  type RepositoryPort,
  type WorkbenchStatePort,
} from './contracts/persistence'
export type { WorkspaceShellActions, WorkspaceShellProps } from './contracts/shell'
export type { WorkspaceSurfaceRenderers } from './contracts/surface'
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
} from './contracts/workbench'
export {
  deriveRepositoryName,
  normalizeRootPath,
  type RepositoryId,
  type RepositoryRef,
  RepositoryRefSchema,
  repositoryIdFromRootPath,
  repositoryRefFromRootPath,
  WORKSPACE_NAVIGATION_ORDER,
  WORKSPACE_SURFACE_REGISTRY,
  type WorkspaceSurfaceDescriptor,
} from './domain/index'
