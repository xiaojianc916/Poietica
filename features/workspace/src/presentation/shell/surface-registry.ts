import { Box, ChartNetwork, FolderTwo, Image, LayersThree, Search } from '@mynaui/icons-react'
import { CONVERSATION_ENTRY_TITLE } from '@poietica/agent-protocol'
import { START_TAB_TITLE, type WorkspaceSurfaceId } from '@poietica/features-workspace/contracts'
/*
 * clock-10 / pencil-ruler / webhook 不在图标库里，是设计系统的本地字形；
 * 它们与库图标同框同粗细，原因见 components/icons/local-glyphs.tsx。
 */
import { ClockTenIcon, PencilRulerIcon, WebhookIcon } from '@poietica/foundations-design-system'
import type { ComponentType } from 'react'
import { AiSurfaceIcon } from './icons/AiSurfaceIcon'

export type SurfaceIcon = ComponentType<{
  readonly className?: string
  readonly 'aria-hidden'?: boolean | 'true' | 'false'
}>

export interface WorkspaceSurfaceDescriptor {
  readonly title: string
  readonly description: string
  readonly icon: SurfaceIcon
}

/**
 * 工作区表面的标题、描述与图标的唯一事实来源。
 *
 * Record<WorkspaceSurfaceId, …> 强制穷尽：新增或重命名 surface 时缺失项会在
 * typecheck 阶段失败，而不是在运行时渲染出 undefined。
 *
 * 「画布」不在这张表里：它不是一个可以并排打开的表面，而是被文档占据的那一格，
 * 其空态是一等的 start 标签。此前它作为 'pages' 混在这里，于是视图层不得不为它
 * 写一个 if 特例，而工作台又无法把它识别成可被画布顶替的槽位。
 */
export const WORKSPACE_SURFACE_REGISTRY: Record<WorkspaceSurfaceId, WorkspaceSurfaceDescriptor> = {
  documents: {
    title: '恢复',
    description: '恢复最近打开的画布和本地文件。',
    icon: FolderTwo,
  },
  search: {
    title: '搜索',
    description: '搜索工作区中的画布、对象和文本内容。',
    icon: Search,
  },
  layers: {
    title: '图层',
    description: '浏览、选择和组织当前画布中的对象层级。',
    icon: LayersThree,
  },
  relations: {
    title: '关系',
    description: '查看并维护画布内容之间的结构化关系。',
    icon: ChartNetwork,
  },
  ai: {
    title: CONVERSATION_ENTRY_TITLE,
    description: '与 AI 协作生成、整理并驱动画布内容。',
    icon: AiSurfaceIcon,
  },
  assets: {
    title: '素材',
    description: '统一管理图片、附件和可复用素材。',
    icon: Image,
  },
  extensions: {
    title: '插件',
    description: '管理为编辑器提供能力的扩展。',
    icon: Box,
  },
  automations: {
    title: '自动化',
    description: '编排在后台自动运行的创作流程。',
    icon: ClockTenIcon,
  },
  hooks: {
    title: 'Hook',
    description: '在关键节点挂载可编程的扩展点。',
    icon: WebhookIcon,
  },
}

/**
 * 「画布」导航项的标识。
 *
 * 它不是 WorkspaceSurfaceId，因为它打开的不是表面而是画布槽；把两者放进同一个
 * 联合类型，导航列表才能保持一张表、一次遍历，而不用在组件里插一个手写特例行。
 */
export const CANVAS_START_NAV_ID = 'canvas-start'

export type WorkspaceNavigationId = WorkspaceSurfaceId | typeof CANVAS_START_NAV_ID

/** 起始页的展示信息。侧栏导航项与起始页标签共用它，标题与图标只有一份。 */
export const CANVAS_START_DESCRIPTOR: WorkspaceSurfaceDescriptor = {
  title: START_TAB_TITLE,
  description: '创建一张新画布，或打开已有的画布文件。',
  icon: PencilRulerIcon,
}

/**
 * 侧边栏顶部导航的展示顺序。
 *
 * 顺序是产品决策，与描述符分离；未列出的表面仍可通过命令面板或标签页打开。
 *
 * 「新建对话」不在此列：它是一个动作而不是一个导航目标，由 SidebarNav 单独渲染。
 */
export const WORKSPACE_NAVIGATION_ORDER: readonly WorkspaceNavigationId[] = [
  'search',
  CANVAS_START_NAV_ID,
  'automations',
  'hooks',
]

export function describeWorkspaceSurface(
  surfaceId: WorkspaceSurfaceId,
): WorkspaceSurfaceDescriptor {
  return WORKSPACE_SURFACE_REGISTRY[surfaceId]
}

export function describeWorkspaceNavigation(
  navigationId: WorkspaceNavigationId,
): WorkspaceSurfaceDescriptor {
  return navigationId === CANVAS_START_NAV_ID
    ? CANVAS_START_DESCRIPTOR
    : WORKSPACE_SURFACE_REGISTRY[navigationId]
}
