/**
 * 工作区表面的唯一注册处。
 *
 * 表面集合、标题、描述、图标标识、导航次序、实现状态只在此处声明一次；
 * WorkspaceSurfaceId 由本表的键派生，不再另立字面量联合。
 *
 * status 是这张表最关键的一列。此前「还没做」不是被写下来的事实，而是
 * WorkspaceSurfaceRenderers 上的一个空位 —— 空位表达不了意图：它跟「写漏了」
 * 长得一模一样，编译器分不出来，读代码的人也分不出来。现在它是一个值：
 *
 *   ready   —— 渲染器是强制的，漏一条是编译错误（见 surface.ts）。
 *   planned —— 导航里画得出来，点进去是一张写明「还没实现」的页面。
 *
 * 于是路线图留在界面上，而类型系统照样看住「说做了的必须真做了」。
 */

export type WorkspaceSurfaceIconId = 'box' | 'clock' | 'message' | 'search' | 'webhook'

export type WorkspaceSurfaceStatus = 'ready' | 'planned'

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
  readonly status: WorkspaceSurfaceStatus
}

export const WORKSPACE_SURFACE_REGISTRY = {
  ai: {
    title: '新建对话',
    description: '与 AI 协作，驱动工具完成任务。',
    iconId: 'message',
    navigationOrder: null,
    status: 'ready',
  },
  search: {
    title: '搜索',
    description: '跨仓库检索文件与会话。',
    iconId: 'search',
    navigationOrder: 0,
    status: 'planned',
  },
  tools: {
    title: 'Tool',
    description: '查看与管理可调用工具。',
    iconId: 'box',
    navigationOrder: 1,
    status: 'planned',
  },
  automations: {
    title: '自动化',
    description: '按计划反复执行的任务。每次运行都是一条对话。',
    iconId: 'clock',
    navigationOrder: 2,
    status: 'ready',
  },
  hooks: {
    title: 'Hook',
    description: '在生命周期节点注入自定义行为。',
    iconId: 'webhook',
    navigationOrder: 3,
    status: 'planned',
  },
} as const satisfies Record<string, WorkspaceSurfaceDescriptor>

export type WorkspaceSurfaceId = keyof typeof WORKSPACE_SURFACE_REGISTRY

/**
 * 真的画得出来的那些表面。
 *
 * 从 status 的字面量推出来，不是手写的第二份名单：注册表改一个字，这个联合
 * 跟着变，组合根少交一条渲染器立刻编译失败。
 */
export type ReadyWorkspaceSurfaceId = {
  [Id in WorkspaceSurfaceId]: (typeof WORKSPACE_SURFACE_REGISTRY)[Id]['status'] extends 'ready'
    ? Id
    : never
}[WorkspaceSurfaceId]

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

/* 运行时这一份也从同一张表派生，不存在会跟类型分叉的第二份名单。 */
const READY_SURFACE_IDS: ReadonlySet<string> = new Set(
  Object.entries(DESCRIPTORS)
    .filter(([, descriptor]) => descriptor.status === 'ready')
    .map(([id]) => id),
)

export function isReadyWorkspaceSurfaceId(id: WorkspaceSurfaceId): id is ReadyWorkspaceSurfaceId {
  return READY_SURFACE_IDS.has(id)
}

/*
 * 导航次序由 navigationOrder 派生，不手工维护第二份数组。
 *
 * flatMap 而不是 filter + sort：filter 之后 TypeScript 并不知道 null 已经没了，
 * 于是上一版的比较器里挂着一个 ?? 0 —— 那是一段永远不会执行的兜底。
 * flatMap 就地收窄类型，兜底随之消失。
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
