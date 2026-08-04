import { Box, Folder, Message, Search } from '@mynaui/icons-react'
import { ClockTenIcon, WebhookIcon } from '@poietica/ui'
import type { ComponentType } from 'react'

import { WORKSPACE_SURFACE_REGISTRY, type WorkspaceSurfaceId } from '../../domain/index'

export type SurfaceIcon = ComponentType<{
  readonly className?: string
  readonly 'aria-hidden'?: boolean | 'true' | 'false'
}>

/**
 * iconId 到组件的映射，全应用唯一一处。
 *
 * 描述符里只有 iconId 字符串，领域层因此不再 import React 组件；
 * 此前 registry 直接把 Search / Message 当数据字段存着，是分层反向。
 * Record<WorkspaceSurfaceId, …> 仍然强制穷尽：漏一个在 typecheck 就失败。
 */
export const SURFACE_ICONS: Record<WorkspaceSurfaceId, SurfaceIcon> = {
  ai: Message,
  repositories: Folder,
  search: Search,
  tools: Box,
  automations: ClockTenIcon,
  hooks: WebhookIcon,
}

export function surfaceIcon(surfaceId: WorkspaceSurfaceId): SurfaceIcon {
  return SURFACE_ICONS[surfaceId]
}

export { WORKSPACE_SURFACE_REGISTRY }
