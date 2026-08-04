/**
 * 工作区表面的唯一注册处。
 *
 * 表面集合、标题、描述、图标标识、导航次序只在此处声明一次；
 * WorkspaceSurfaceId 由本表的键派生，不再另立字面量联合。
 *
 * iconId 是字面量联合而非 string：presentation 侧的图标表因此可以是
 * 全域映射（Record<WorkspaceSurfaceIconId, ...>），不需要运行时兜底分支。
 * 领域层不认识 React，descriptor 里不会出现组件引用。
 */

export type WorkspaceSurfaceIconId = 'box' | 'clock' | 'folder' | 'message' | 'search' | 'webhook'

export interface WorkspaceSurfaceDescriptor {
  readonly title: string
  readonly description: string
  readonly iconId: WorkspaceSurfaceIconId
  /**
   * 侧边栏导航中的次序。
   *
   * null 表示该表面不出现在导航里。这里刻意不用可选属性：可选属性无法区分
   * "不进导航" 与 "写漏了"，而 as const 之下漏写的那条记录连键都不存在，
   * 读取时会直接编译失败。
   */
  readonly navigationOrder: number | null
}

export const WORKSPACE_SURFACE_REGISTRY = {
  ai: {
    title: '新建对话',
    description: '与 AI 协作，驱动工具完成任务。',
    iconId: 'message',
    navigationOrder: null,
  },
  repositories: {
    title: '仓库',
    description: '按仓库组织会话、自动化与工具。',
    iconId: 'folder',
    navigationOrder: 0,
  },
  search: {
    title: '搜索',
    description: '跨仓库检索文件与会话。',
    iconId: 'search',
    navigationOrder: 1,
  },
  tools: {
    title: 'Tool',
    description: '查看与管理可调用工具。',
    iconId: 'box',
    navigationOrder: 2,
  },
  automations: {
    title: '自动化',
    description: '按计划或事件触发的任务。',
    iconId: 'clock',
    navigationOrder: 3,
  },
  hooks: {
    title: 'Hook',
    description: '在生命周期节点注入自定义行为。',
    iconId: 'webhook',
    navigationOrder: 4,
  },
} as const satisfies Record<string, WorkspaceSurfaceDescriptor>

export type WorkspaceSurfaceId = keyof typeof WORKSPACE_SURFACE_REGISTRY

/*
 * as const 之后每条记录都是字面量类型，直接索引取不到接口上的属性。
 * 放宽一次到接口类型，后续读取全部经由这里，避免逐处 as。
 */
const DESCRIPTORS: Record<WorkspaceSurfaceId, WorkspaceSurfaceDescriptor> =
  WORKSPACE_SURFACE_REGISTRY

export const DEFAULT_SURFACE_ID: WorkspaceSurfaceId = 'ai'

/* 会话标签的名字就是默认表面的标题，不另抄一份字面量。 */
export const CONVERSATION_ENTRY_TITLE: string = WORKSPACE_SURFACE_REGISTRY.ai.title

export function describeWorkspaceSurface(id: WorkspaceSurfaceId): WorkspaceSurfaceDescriptor {
  return DESCRIPTORS[id]
}

export function isWorkspaceSurfaceId(value: string): value is WorkspaceSurfaceId {
  return Object.hasOwn(WORKSPACE_SURFACE_REGISTRY, value)
}

/* 导航次序由 navigationOrder 派生，不手工维护第二份数组。 */
export const WORKSPACE_NAVIGATION_ORDER: readonly WorkspaceSurfaceId[] = (
  Object.keys(WORKSPACE_SURFACE_REGISTRY) as WorkspaceSurfaceId[]
)
  .filter((id) => DESCRIPTORS[id].navigationOrder !== null)
  .sort((a, b) => (DESCRIPTORS[a].navigationOrder ?? 0) - (DESCRIPTORS[b].navigationOrder ?? 0))
