import { Box, ChartNetwork, FolderTwo, Grid, Image, LayersThree, Search } from '@mynaui/icons-react'
import type { ComponentType } from 'react'

import type { WorkspaceSurfaceId } from '../../contracts/workbench-contract'
import { AiSurfaceIcon } from './icons/AiSurfaceIcon'

export type SurfaceIcon = ComponentType<{
  readonly className?: string
  readonly 'aria-hidden'?: boolean | 'true' | 'false'
}>

export interface WorkspaceSurfaceDescriptor {
  readonly title: string
  readonly icon: SurfaceIcon
}

/**
 * 工作区表面的标题与图标的唯一事实来源。
 *
 * 约束：Record<WorkspaceSurfaceId, …> 强制穷尽。新增或重命名 surface 时，
 * 缺失项会在 typecheck 阶段失败，而不是在运行时渲染出 undefined 组件。
 *
 * 任何新增的表面消费者（导航栏、侧栏、标签页、命令面板）必须读取此注册表，
 * 不得再维护第二份 id → 图标/标题 映射。
 */
export const WORKSPACE_SURFACE_REGISTRY: Record<WorkspaceSurfaceId, WorkspaceSurfaceDescriptor> = {
  pages: { title: '画布', icon: Grid },
  documents: { title: '恢复', icon: FolderTwo },
  search: { title: '搜索', icon: Search },
  layers: { title: '图层', icon: LayersThree },
  relations: { title: '关系', icon: ChartNetwork },
  ai: { title: 'AI', icon: AiSurfaceIcon },
  assets: { title: '素材', icon: Image },
  extensions: { title: '插件', icon: Box },
}

export function describeWorkspaceSurface(
  surfaceId: WorkspaceSurfaceId,
): WorkspaceSurfaceDescriptor {
  return WORKSPACE_SURFACE_REGISTRY[surfaceId]
}
