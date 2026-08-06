import { Message } from '@mynaui/icons-react'
import { ClockTenIcon } from '@poietica/ui'
import type { ComponentType } from 'react'

import {
  describeWorkspaceSurface,
  type WorkspaceSurfaceIconId,
  type WorkspaceSurfaceId,
} from '../surface-registry'

/**
 * iconId 到组件的唯一映射。
 *
 * 领域层只声明图标标识，组件引用留在这一层，分层方向因此不会反过来。
 * 键是 WorkspaceSurfaceIconId 而非 WorkspaceSurfaceId：否则新增表面时
 * 得同时改两张按表面分行的表，又变成两份真相。
 *
 * 映射是全域的（Record 而非 Partial），漏一个图标是编译错误，
 * 所以这里不需要、也不应该有 ?? 兜底。
 */

export type SurfaceIcon = ComponentType<{
  readonly className?: string
  readonly 'aria-hidden'?: boolean | 'true' | 'false'
}>

const SURFACE_ICONS: Record<WorkspaceSurfaceIconId, SurfaceIcon> = {
  clock: ClockTenIcon,
  message: Message,
}

export function surfaceIcon(id: WorkspaceSurfaceId): SurfaceIcon {
  return SURFACE_ICONS[describeWorkspaceSurface(id).iconId]
}
