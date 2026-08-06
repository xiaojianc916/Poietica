import type { ReactNode } from 'react'

import type { ReadyWorkspaceSurfaceId } from './surface-registry'

/**
 * 表面渲染扩展点。
 *
 * 键是 ReadyWorkspaceSurfaceId，不是 WorkspaceSurfaceId，也不是 Partial：
 *
 *   - 注册表里 status: 'ready' 的每一条，组合根都必须交出渲染器，漏一条是
 *     编译错误；
 *   - status: 'planned' 的那几条不在这个 Record 里，所以「还没做」不需要
 *     一个假渲染器来顶着。
 *
 * 此前这里是 Partial<Record<...>>，两种情况都塌进同一个空位里，于是
 * WorkspaceSurface 只能靠运行时 if (render) 兜底 —— 一个编译期能证明的事实
 * 被降级成了运行期分支。
 *
 * 所有权：apps 组合根。workspace 只消费，不实现具体业务表面。
 */
export type WorkspaceSurfaceRenderers = Record<ReadyWorkspaceSurfaceId, () => ReactNode>
