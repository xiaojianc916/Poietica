/**
 * 工作区表面的唯一注册处。
 *
 * 表面集合、标题、描述、图标标识、导航次序只在此处声明一次；
 * WorkspaceSurfaceId 由本表的键派生，不再另立字面量联合。
 *
 * 这张表只登记真的画得出来的表面。此前它还登记了 search / tools / hooks
 * 三条，三条都没有渲染器 —— 一个点了只出现一张空态图的导航项不是「以后要做
 * 的功能」，它是一次对用户的失信。渲染器现在是全域 Record（见 surface.ts），
 * 登记一条就必须交出一条，这张表因此也不可能再长出装饰品。
 *
 * iconId 是字面量联合而非 string：presentation 侧的图标表因此可以是
 * 全域映射，不需要运行时兜底分支。领域层不认识 React，descriptor 里不会
 * 出现组件引用。
 */

export type WorkspaceSurfaceIconId = 'clock' | 'message'

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
  automations: {
    title: '自动化',
    description: '按计划反复执行的任务。每次运行都是一条对话。',
    iconId: 'clock',
    navigationOrder: 0,
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

/*
 * 导航次序由 navigationOrder 派生，不手工维护第二份数组。
 *
 * flatMap 而不是 filter + sort：filter 之后 TypeScript 并不知道 null 已经没了，
 * 于是上一版的比较器里挂着一个 `?? 0` —— 那是一段永远不会执行的兜底，也是
 * 「编译期能证明的事实被降级成运行期分支」的又一处。flatMap 就地收窄类型，
 * 兜底随之消失。
 */
export const WORKSPACE_NAVIGATION_ORDER: readonly WorkspaceSurfaceId[] = (
  Object.keys(WORKSPACE_SURFACE_REGISTRY) as WorkspaceSurfaceId[]
)
  .flatMap((id) => {
    const { navigationOrder } = DESCRIPTORS[id]

    return navigationOrder === null ? [] : [{ id, navigationOrder }]
  })
  .sort((left, right) => left.navigationOrder - right.navigationOrder)
  .map((entry) => entry.id)
