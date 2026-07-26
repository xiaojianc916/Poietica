export type CanvasId = string
export type CanvasSessionId = string
export type WorkbenchTabId = string

export type CanvasTabStatus = 'clean' | 'dirty' | 'saving' | 'failed'

export type WorkspaceSurfaceId =
  | 'pages'
  | 'documents'
  | 'search'
  | 'layers'
  | 'relations'
  | 'ai'
  | 'assets'
  | 'extensions'

interface WorkbenchTabBase {
  readonly id: WorkbenchTabId
  readonly title: string
  readonly isActive: boolean
  readonly canClose: boolean
}

export interface StartTabViewModel extends WorkbenchTabBase {
  readonly kind: 'start'
}

export interface CanvasTabViewModel extends WorkbenchTabBase {
  readonly kind: 'canvas'
  readonly sessionId: CanvasSessionId
  readonly canvasId: CanvasId
  readonly status?: CanvasTabStatus
}

export interface WorkspaceTabViewModel extends WorkbenchTabBase {
  readonly kind: 'workspace'
  readonly surfaceId: WorkspaceSurfaceId
}

export type WorkbenchTabViewModel = StartTabViewModel | CanvasTabViewModel | WorkspaceTabViewModel

export interface StartSurfaceViewModel {
  readonly kind: 'start'
  readonly tabId: WorkbenchTabId
}

export interface ActiveCanvasViewModel {
  readonly kind: 'canvas'
  readonly tabId: WorkbenchTabId
  readonly sessionId: CanvasSessionId
  readonly canvasId: CanvasId
  readonly title: string
}

export interface WorkspaceSurfaceViewModel {
  readonly kind: 'workspace'
  readonly tabId: WorkbenchTabId
  readonly surfaceId: WorkspaceSurfaceId
  readonly title: string
}

export type WorkbenchSurfaceViewModel =
  | StartSurfaceViewModel
  | ActiveCanvasViewModel
  | WorkspaceSurfaceViewModel

export interface WorkbenchViewModel {
  readonly activeTabId: WorkbenchTabId
  readonly activeSessionId: CanvasSessionId | null
  readonly tabs: readonly WorkbenchTabViewModel[]
  readonly activeSurface: WorkbenchSurfaceViewModel
  readonly activeCanvas: ActiveCanvasViewModel | null
}

export interface CreateCanvasRequest {
  readonly title: string
  readonly canvasId?: CanvasId
  readonly sessionId?: CanvasSessionId
}

export interface OpenWorkspaceSurfaceRequest {
  readonly surfaceId: WorkspaceSurfaceId
  readonly title: string
}

export interface WorkbenchSessionCommands {
  readonly createCanvas: (request: CreateCanvasRequest) => void
  readonly openWorkspaceSurface: (request: OpenWorkspaceSurfaceRequest) => void
  readonly activateTab: (tabId: WorkbenchTabId) => void
  readonly closeTab: (tabId: WorkbenchTabId) => void
  readonly moveTab: (tabId: WorkbenchTabId, targetIndex: number) => void

  /**
   * Document-boundary adapters.
   *
   * CanvasDocumentService continues to identify documents by session ID.
   * Workbench chrome must otherwise operate on WorkbenchTabId.
   */
  readonly activateCanvas: (sessionId: CanvasSessionId) => void
  readonly closeCanvas: (sessionId: CanvasSessionId) => void
}

export interface WorkbenchSessionStore extends WorkbenchSessionCommands {
  readonly getSnapshot: () => WorkbenchViewModel
  readonly subscribe: (listener: () => void) => () => void
}

export const START_TAB_ID: WorkbenchTabId = 'workbench:start'

export const DEFAULT_SURFACE_TAB_ID: WorkbenchTabId = 'workspace:ai'

const DEFAULT_TAB: WorkspaceTabViewModel = Object.freeze({
  id: DEFAULT_SURFACE_TAB_ID,
  kind: 'workspace',
  title: 'AI',
  isActive: true,
  canClose: true,
  surfaceId: 'ai',
})

const DEFAULT_SURFACE: WorkspaceSurfaceViewModel = Object.freeze({
  kind: 'workspace',
  tabId: DEFAULT_SURFACE_TAB_ID,
  surfaceId: 'ai',
  title: 'AI',
})

/**
 * Fallback snapshot used before the session controller publishes its first
 * projection. It mirrors the controller's startup state (the AI surface) so the
 * first paint never flashes a placeholder tab.
 */
export const EMPTY_WORKBENCH_VIEW_MODEL: WorkbenchViewModel = Object.freeze({
  activeTabId: DEFAULT_SURFACE_TAB_ID,
  activeSessionId: null,
  tabs: Object.freeze([DEFAULT_TAB]),
  activeSurface: DEFAULT_SURFACE,
  activeCanvas: null,
})
