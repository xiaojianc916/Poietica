export type WorkbenchTabId = string

/** 一条对话的身份就是它的 thread id：一条对话最多一格。 */
export type ConversationId = string

import {
  CONVERSATION_ENTRY_TITLE,
  DEFAULT_SURFACE_ID,
  describeWorkspaceSurface,
  type WorkspaceSurfaceId,
} from './surface-registry'

export { CONVERSATION_ENTRY_TITLE, type WorkspaceSurfaceId }

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

/**
 * 打开一个表面。
 *
 * 只收 id：标题是 registry 已经拥有的事实，让调用方再传一遍就是让同一个
 * 值有两个来源——此前 WorkspaceShell 正是靠 describeWorkspaceSurface(id).title
 * 把查出来的值又喂了回去。
 */
export interface OpenWorkspaceSurfaceRequest {
  readonly surfaceId: WorkspaceSurfaceId
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

  /**
   * 这条对话不存在了：开着它的那一格跟着消失。
   *
   * 与 closeTab 不是同一件事。closeTab 说的是「人按了叉」，身份是标签；
   * 这里说的是「这条对话没了」，身份是 threadId —— 调用方不必知道它此刻
   * 有没有被提升成标签，也不必自己去拼 tab id。正在看着它时按标签条的
   * 顺序落到邻居上，一格都不剩就回到「新建对话」。
   */
  readonly closeConversation: (threadId: ConversationId) => void
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
 * 默认表面的标签 id 由默认表面 id 派生，不另立字面量。
 */
export const DEFAULT_SURFACE_TAB_ID: WorkbenchTabId = `workspace:${DEFAULT_SURFACE_ID}`

/**
 * 首帧兜底快照。
 *
 * 由 registry 派生而不是手写字面量：此前这里有 DEFAULT_TAB 与 DEFAULT_SURFACE
 * 两个冻结对象，controller 里还有第三个 DEFAULT_ENTRY —— 同一个「默认表面」
 * 存了三份，靠三条运行时不变量互相看住。现在只有这一处。
 */
export function emptyWorkbenchViewModel(): WorkbenchViewModel {
  const descriptor = describeWorkspaceSurface(DEFAULT_SURFACE_ID)

  return {
    activeTabId: DEFAULT_SURFACE_TAB_ID,
    tabs: [
      {
        id: DEFAULT_SURFACE_TAB_ID,
        kind: 'workspace',
        title: descriptor.title,
        isActive: true,
        canClose: true,
        surfaceId: DEFAULT_SURFACE_ID,
      },
    ],
    activeSurface: {
      kind: 'workspace',
      tabId: DEFAULT_SURFACE_TAB_ID,
      surfaceId: DEFAULT_SURFACE_ID,
      title: descriptor.title,
    },
  }
}
