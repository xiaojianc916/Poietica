import type { ReactNode } from 'react'

import type { WorkspaceSurfaceId } from './workbench'

/**
 * 表面渲染扩展点。
 *
 * 全域 Record，不是 Partial：注册表登记一条表面，组合根就必须交出一条渲染器，
 * 漏一条是编译错误。此前这里是 Partial，于是 search / tools / hooks / automations
 * 四条登记在册却无人实现，点进去看到的是 WorkspaceSurface 的兜底空态 —— 那段
 * 兜底的存在本身就是这个 Partial 的产物。
 *
 * 同一条规则在 shell/surface-icons.ts 上已经写过一遍（「映射是全域的，漏一个
 * 图标是编译错误」）。两处现在真的是同一条了。
 *
 * 所有权：apps 组合根。workspace 只消费，不实现具体业务表面。
 */
export type WorkspaceSurfaceRenderers = Record<WorkspaceSurfaceId, () => ReactNode>
