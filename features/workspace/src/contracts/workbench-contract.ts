export type CanvasId = string
export type CanvasSessionId = string
export type WorkbenchTabId = string

/** 一条对话的身份就是它的 thread id：一条对话最多一格。 */
export type ConversationId = string

export type CanvasTabStatus = 'clean' | 'dirty' | 'saving' | 'failed'

export type WorkspaceSurfaceId =
  | 'documents'
  | 'search'
  | 'layers'
  | 'relations'
  | 'ai'
  | 'tools'
  | 'assets'
  | 'extensions'
  | 'automations'
  | 'hooks'

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
  readonly status: CanvasTabStatus
}

export interface ConversationTabViewModel extends WorkbenchTabBase {
  readonly kind: 'conversation'
  readonly threadId: ConversationId
}

export interface WorkspaceTabViewModel extends WorkbenchTabBase {
  readonly kind: 'workspace'
  readonly surfaceId: WorkspaceSurfaceId
}

export type WorkbenchTabViewModel =
  | StartTabViewModel
  | CanvasTabViewModel
  | ConversationTabViewModel
  | WorkspaceTabViewModel

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

export interface ActiveConversationViewModel {
  readonly kind: 'conversation'
  readonly tabId: WorkbenchTabId
  readonly threadId: ConversationId
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
  | ActiveConversationViewModel
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

export interface OpenConversationRequest {
  readonly threadId: ConversationId
  readonly title: string
}

export interface WorkbenchSessionCommands {
  readonly createCanvas: (request: CreateCanvasRequest) => void
  readonly openWorkspaceSurface: (request: OpenWorkspaceSurfaceRequest) => void

  /**
   * 打开一条已有对话。
   *
   * id 固定为 conversation:<threadId>，所以一条对话最多只有一格，已经开着时
   * 只激活它。正在看的那一格本身就是 AI 时就地替换：侧栏是导航，不是标签
   * 工厂。其它形态一律插在活动标签右侧。
   */
  readonly openConversation: (request: OpenConversationRequest) => void

  /** 「在新标签页打开」：永远追加一格，从不顶掉正在看的那一格。 */
  readonly openConversationInNewTab: (request: OpenConversationRequest) => void

  /** 官方标题到达后改写标签标题；同值直接返回。 */
  readonly setConversationTitle: (threadId: ConversationId, title: string) => void

  /**
   * 打开画布槽的空态。
   *
   * 画布不是一个 surface：它是被文档占据的那一格。空态因此是一等的标签形态
   * （kind: 'start'），而不是某个 surfaceId 在视图层的 if 特例。id 固定为
   * START_TAB_ID，所以起始页天然最多只有一个。
   */
  readonly openCanvasStart: () => void

  readonly activateTab: (tabId: WorkbenchTabId) => void
  readonly closeTab: (tabId: WorkbenchTabId) => void
  readonly moveTab: (tabId: WorkbenchTabId, targetIndex: number) => void

  /**
   * 画布保存状态的唯一写入口。
   *
   * 状态是标签视图模型的一部分，所以由拥有视图模型的这个 store 保管：
   * 文档域经 canvas-workflow 上报，视图只读快照。此前它由组合根在读侧
   * 装饰，契约声明了字段而投影函数从不赋值，等于两个所有者。
   */
  readonly setCanvasStatus: (sessionId: CanvasSessionId, status: CanvasTabStatus) => void

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

/**
 * 起始页（画布槽空态）的标签标题。
 *
 * 与侧栏「画布」导航项同名同图标：同一个目标只允许有一个名字，标签与导航
 * 因此不可能对不上。
 */
export const START_TAB_TITLE = '画布'

/**
 * 会话入口（AI 表面）的名字。
 *
 * 与侧栏「新建对话」导航项、会话列表的加号同名：一个入口只允许有一个名字，
 * 标签、导航与按钮因此不可能对不上。此前这里写死 'AI'，导航写「新建对话」，
 * 加号写「新建会话」，兜底标题写 'New Agent'——同一格从不同入口进去，标题
 * 就不一样，看上去像是缓存在作怪。
 */
export const CONVERSATION_ENTRY_TITLE = '新建对话'

export const DEFAULT_SURFACE_TAB_ID: WorkbenchTabId = 'workspace:ai'

const DEFAULT_TAB: WorkspaceTabViewModel = Object.freeze({
  id: DEFAULT_SURFACE_TAB_ID,
  kind: 'workspace',
  title: CONVERSATION_ENTRY_TITLE,
  isActive: true,
  canClose: true,
  surfaceId: 'ai',
})

const DEFAULT_SURFACE: WorkspaceSurfaceViewModel = Object.freeze({
  kind: 'workspace',
  tabId: DEFAULT_SURFACE_TAB_ID,
  surfaceId: 'ai',
  title: CONVERSATION_ENTRY_TITLE,
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
