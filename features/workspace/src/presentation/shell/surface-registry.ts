import {
  Box,
  ChartNetwork,
  Code,
  FolderTwo,
  Grid,
  Image,
  LayersThree,
  RefreshAlt,
  Search,
} from '@mynaui/icons-react'
import type { ComponentType } from 'react'

import type { WorkspaceSurfaceId } from '../../contracts/workbench-contract'
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
 * 消费者（活动栏、侧栏面板占位、主区表面占位）只读本表，不得再抄第二份。
 */
export const WORKSPACE_SURFACE_REGISTRY: Record<WorkspaceSurfaceId, WorkspaceSurfaceDescriptor> = {
  pages: {
    title: '画布',
    description: '浏览当前文档中的画布页面。',
    icon: Grid,
  },
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
    title: 'AI',
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
    icon: RefreshAlt,
  },
  hooks: {
    title: 'Hook',
    description: '在关键节点挂载可编程的扩展点。',
    icon: Code,
  },
}

/**
 * 侧边栏顶部导航的展示顺序。
 *
 * 顺序是产品决策，与描述符分离；未列出的表面仍可通过命令面板或标签页打开。
 *
 * 「新建对话」不在此列：它是一个动作而不是一个 surface，由 SidebarNav 单独
 * 渲染，避免在注册表里塞一个没有面板的假 surface。
 */
export const WORKSPACE_NAVIGATION_ORDER: readonly WorkspaceSurfaceId[] = [
  'search',
  'pages',
  'automations',
  'hooks',
]

export function describeWorkspaceSurface(
  surfaceId: WorkspaceSurfaceId,
): WorkspaceSurfaceDescriptor {
  return WORKSPACE_SURFACE_REGISTRY[surfaceId]
}
