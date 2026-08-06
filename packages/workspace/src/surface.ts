import type { ReactNode } from 'react'

import type { WorkspaceSurfaceId } from './workbench'

/**
 * 表面渲染扩展点。
 *
 * 所有权：apps 组合根。workspace 只消费，不实现具体业务表面。
 */
export type WorkspaceSurfaceRenderers = Partial<Record<WorkspaceSurfaceId, () => ReactNode>>
