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

const START_TAB: StartTabViewModel = Object.freeze({
  id: START_TAB_ID,
  kind: 'start',
  title: '新标签页',
  isActive: true,
  canClose: false,
})

const START_SURFACE: StartSurfaceViewModel = Object.freeze({
  kind: 'start',
  tabId: START_TAB_ID,
})

export const EMPTY_WORKBENCH_VIEW_MODEL: WorkbenchViewModel = Object.freeze({
  activeTabId: START_TAB_ID,
  activeSessionId: null,
  tabs: Object.freeze([START_TAB]),
  activeSurface: START_SURFACE,
  activeCanvas: null,
})
