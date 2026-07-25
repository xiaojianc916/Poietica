import type { ReactNode } from 'react'

import type { WorkspaceSurfaceId } from './workbench-contract'

/**
 * 表面渲染扩展点。
 *
 * 所有权：apps 组合根。workspace 只消费，不实现具体业务表面。
 */
export type WorkspaceSurfaceRenderers = Partial<Record<WorkspaceSurfaceId, () => ReactNode>>

/**
 * Sidebar panel bodies contributed by the application composition root.
 *
 * features/* must not depend on each other, so the workspace shell only
 * declares the slot; the concrete AI panel lives in features/ai and is
 * injected by apps/desktop.
 */
export type WorkspacePanelRenderers = Partial<Record<WorkspaceSurfaceId, () => ReactNode>>
