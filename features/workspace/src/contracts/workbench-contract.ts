export type WorkbenchTabId = string

/** 一条对话的身份就是它的 thread id：一条对话最多一格。 */
export type ConversationId = string

export type WorkspaceSurfaceId = 'search' | 'ai' | 'tools' | 'automations' | 'hooks'

interface WorkbenchTabBase {
  readonly id: WorkbenchTabId
  readonly title: string
  readonly isActive: boolean
  readonly canClose: boolean
}

export interface ConversationTabViewModel extends WorkbenchTabBase {
  readonly kind: 'conversation'
  readonly threadId: ConversationId
}

export interface WorkspaceTabViewModel extends WorkbenchTabBase {
  readonly kind: 'workspace'
  readonly surfaceId: WorkspaceSurfaceId
}

export type WorkbenchTabViewModel = ConversationTabViewModel | WorkspaceTabViewModel

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

export type WorkbenchSurfaceViewModel = ActiveConversationViewModel | WorkspaceSurfaceViewModel

/**
 * 工作台快照。
 *
 * 标签与活动表面是同一份投影的两个面，没有第三个字段。此前另有两个只服务
 * 文档域的镜像字段，与活动表面说的是同一件事，靠三条不变量互相看住——那几条
 * 不变量的存在本身就是"同一真相存了三份"的证据。
 */
export interface WorkbenchViewModel {
  readonly activeTabId: WorkbenchTabId
  readonly tabs: readonly WorkbenchTabViewModel[]
  readonly activeSurface: WorkbenchSurfaceViewModel
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

  readonly activateTab: (tabId: WorkbenchTabId) => void
  readonly closeTab: (tabId: WorkbenchTabId) => void
  readonly moveTab: (tabId: WorkbenchTabId, targetIndex: number) => void
}

export interface WorkbenchSessionStore extends WorkbenchSessionCommands {
  readonly getSnapshot: () => WorkbenchViewModel
  readonly subscribe: (listener: () => void) => () => void
}

/**
 * 会话入口（AI 表面）的名字。
 *
 * 与侧栏「新建对话」导航项、会话列表的加号、标签条的加号同名：一个入口只
 * 允许有一个名字，标签、导航与按钮因此不可能对不上。
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
 * 会话控制器发布第一份投影之前的兜底快照。它与控制器的启动态一致（AI 表面），
 * 所以首帧不会闪出一个占位标签。
 */
export const EMPTY_WORKBENCH_VIEW_MODEL: WorkbenchViewModel = Object.freeze({
  activeTabId: DEFAULT_SURFACE_TAB_ID,
  tabs: Object.freeze([DEFAULT_TAB]),
  activeSurface: DEFAULT_SURFACE,
})
