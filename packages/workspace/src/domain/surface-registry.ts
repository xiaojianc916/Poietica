/**
 * 工作区表面的唯一注册处。
 *
 * id 就是这张表的键：没有第二处字面量联合，新增表面只改这一处。
 * 描述符携带 iconId 而不是组件——领域层不认识渲染技术，iconId 到组件的
 * 映射属于 presentation。
 */
export interface WorkspaceSurfaceDescriptor {
  readonly title: string
  readonly description: string
  readonly iconId: string
  /** 侧栏导航的排序权重。未给出即不出现在导航中，仍可由命令面板打开。 */
  readonly navigationOrder?: number
}

/**
 * 会话入口的名字。
 *
 * 侧栏导航项、会话列表加号、标签条加号读的都是这一个常量，
 * 因此三处不可能对不上。
 */
export const CONVERSATION_ENTRY_TITLE = '新建对话'

export const WORKSPACE_SURFACE_REGISTRY = {
  ai: {
    title: CONVERSATION_ENTRY_TITLE,
    description: '与 AI 协作，驱动工具完成任务。',
    iconId: 'message',
  },
  repositories: {
    title: '仓库',
    description: '打开与切换仓库，按仓库归拢会话。',
    iconId: 'folder',
    navigationOrder: 10,
  },
  search: {
    title: '搜索',
    description: '搜索当前仓库中的会话、工具与文本内容。',
    iconId: 'search',
    navigationOrder: 20,
  },
  tools: {
    title: 'Tool',
    description: '管理内置工具、Skill 与 MCP 服务器。',
    iconId: 'box',
    navigationOrder: 30,
  },
  automations: {
    title: '自动化',
    description: '编排在后台自动运行的创作流程。',
    iconId: 'clock-10',
    navigationOrder: 40,
  },
  hooks: {
    title: 'Hook',
    description: '在关键节点挂载可编程的扩展点。',
    iconId: 'webhook',
    navigationOrder: 50,
  },
} as const satisfies Record<string, WorkspaceSurfaceDescriptor>

export type WorkspaceSurfaceId = keyof typeof WORKSPACE_SURFACE_REGISTRY

/** 导航顺序由 navigationOrder 派生，不再手抄第二份数组。 */
export const WORKSPACE_NAVIGATION_ORDER: readonly WorkspaceSurfaceId[] = Object.freeze(
  (Object.keys(WORKSPACE_SURFACE_REGISTRY) as WorkspaceSurfaceId[])
    .filter((id) => WORKSPACE_SURFACE_REGISTRY[id].navigationOrder !== undefined)
    .sort(
      (left, right) =>
        (WORKSPACE_SURFACE_REGISTRY[left].navigationOrder ?? 0) -
        (WORKSPACE_SURFACE_REGISTRY[right].navigationOrder ?? 0),
    ),
)

export const DEFAULT_SURFACE_ID: WorkspaceSurfaceId = 'ai'

export function describeWorkspaceSurface(
  surfaceId: WorkspaceSurfaceId,
): WorkspaceSurfaceDescriptor {
  return WORKSPACE_SURFACE_REGISTRY[surfaceId]
}

/** 持久化与 IPC 的入口校验：外部字符串不可信。 */
export function isWorkspaceSurfaceId(value: unknown): value is WorkspaceSurfaceId {
  return typeof value === 'string' && value in WORKSPACE_SURFACE_REGISTRY
}
