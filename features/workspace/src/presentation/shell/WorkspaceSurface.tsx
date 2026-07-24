import {
  Box,
  ChartNetwork,
  ChartNoAxesCombined,
  FolderTwo,
  Grid,
  Image,
  LayersThree,
  Search,
} from '@mynaui/icons-react'
import type { ComponentType } from 'react'

import type { WorkspaceSurfaceId } from '../../contracts/workbench-contract'

interface WorkspaceSurfaceDefinition {
  readonly title: string
  readonly description: string
  readonly icon: ComponentType<{ readonly className?: string }>
}

const SURFACES: Record<WorkspaceSurfaceId, WorkspaceSurfaceDefinition> = {
  pages: {
    title: '画布',
    description: '浏览当前文档中的画布页面。',
    icon: Grid,
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
  data: {
    title: '自动化',
    description: '创建和管理可执行的画布自动化流程。',
    icon: ChartNoAxesCombined,
  },
  documents: {
    title: '恢复',
    description: '恢复最近打开的画布和本地文件。',
    icon: FolderTwo,
  },
}

export interface WorkspaceSurfaceProps {
  readonly surfaceId: WorkspaceSurfaceId
}

export function WorkspaceSurface({ surfaceId }: WorkspaceSurfaceProps) {
  const definition = SURFACES[surfaceId]
  const Icon = definition.icon

  return (
    <section
      aria-labelledby={`workspace-surface-title-${surfaceId}`}
      className="relative grid h-full place-items-center overflow-hidden bg-canvas px-8"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(var(--color-divider)_0.7px,transparent_0.7px)] bg-size-[18px_18px] opacity-35"
      />

      <div className="relative max-w-md text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-xl border border-divider bg-background shadow-sm">
          <Icon className="size-5 text-muted-foreground" />
        </div>

        <h1
          className="mt-4 text-base font-semibold tracking-tight"
          id={`workspace-surface-title-${surfaceId}`}
        >
          {definition.title}
        </h1>

        <p className="mt-2 text-xs leading-5 text-muted-foreground">{definition.description}</p>
      </div>
    </section>
  )
}
