import type { WorkspaceSurfaceRenderers } from '../surface'
import type { WorkspaceSurfaceId } from '../workbench'

export interface WorkspaceSurfaceProps {
  readonly surfaceId: WorkspaceSurfaceId

  /**
   * 由 apps 组合根注入的表面渲染器。
   *
   * workspace 不得依赖任何 feature 包；具体表面通过此扩展点接入。
   */
  readonly renderers: WorkspaceSurfaceRenderers
}

/**
 * 表面渲染的唯一出口。
 *
 * 没有兜底分支。renderers 是全域 Record（见 ../surface.ts），注册表里的每一个
 * 表面都必然有渲染器，「查不到」在类型上不成立。此前这里有一段图标 + 标题 +
 * 点阵背景的空态，它唯一的用途是替四个没人实现的表面遮丑 —— 遮丑的代价是
 * 用户点进去看到一张什么也做不了的图。
 */
export function WorkspaceSurface({ surfaceId, renderers }: WorkspaceSurfaceProps) {
  return <>{renderers[surfaceId]()}</>
}
