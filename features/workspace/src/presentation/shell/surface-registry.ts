import { Box, Search } from '@mynaui/icons-react'
import { CONVERSATION_ENTRY_TITLE } from '@poietica/features-workspace'
import type { WorkspaceSurfaceId } from '@poietica/features-workspace/contracts'
/*
 * ai / clock-10 / webhook 不在图标库里，是设计系统的本地字形；
 * 它们与库图标同框同粗细，原因见 components/icons/local-glyphs.tsx。
 */
import { AiSurfaceIcon, ClockTenIcon, WebhookIcon } from '@poietica/foundations-design-system'
import type { ComponentType } from 'react'

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
 * 这张表是导航的唯一事实来源：导航项就是表面，没有第二种导航 ID，也没有
 * 需要在视图层写 if 的例外。
 */
export const WORKSPACE_SURFACE_REGISTRY: Record<WorkspaceSurfaceId, WorkspaceSurfaceDescriptor> = {
  search: {
    title: '搜索',
    description: '搜索工作区中的会话、工具与文本内容。',
    icon: Search,
  },
  ai: {
    title: CONVERSATION_ENTRY_TITLE,
    description: '与 AI 协作，驱动工具完成任务。',
    icon: AiSurfaceIcon,
  },
  tools: {
    title: 'Tool',
    description: '管理内置工具、Skill 与 MCP 服务器。',
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
 * 侧边栏顶部导航的展示顺序。
 *
 * 顺序是产品决策，与描述符分离；未列出的表面仍可通过命令面板或标签页打开。
 *
 * 「新建对话」不在此列：它是一个动作而不是一个导航目标，由 SidebarNav 单独渲染。
 */
export const WORKSPACE_NAVIGATION_ORDER: readonly WorkspaceSurfaceId[] = [
  'search',
  'tools',
  'automations',
  'hooks',
]

export function describeWorkspaceSurface(
  surfaceId: WorkspaceSurfaceId,
): WorkspaceSurfaceDescriptor {
  return WORKSPACE_SURFACE_REGISTRY[surfaceId]
}
