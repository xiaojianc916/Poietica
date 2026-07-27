import { describe, expect, it } from 'vitest'

import type { WorkspaceSurfaceId } from '../../contracts/workbench-contract'
import {
  describeWorkspaceNavigation,
  WORKSPACE_NAVIGATION_ORDER,
  WORKSPACE_SURFACE_REGISTRY,
} from './surface-registry'

const SURFACE_IDS: readonly WorkspaceSurfaceId[] = [
  'documents',
  'search',
  'layers',
  'relations',
  'ai',
  'assets',
  'extensions',
  'automations',
  'hooks',
]

/*
 * React 的组件类型不一定是函数。
 *
 * 这张注册表里的图标来自 @mynaui/icons-react，每个都被 forwardRef 包过一层，
 * 因此 typeof 是 'object'。旧断言要求它是函数，于是循环里第一个图标就失败，
 * 而所有图标其实渲染得好好的。这个测试真正关心的是 React 能否渲染这个值，
 * 而普通函数组件、forwardRef、memo 三者都满足这一点。
 */
function isRenderableComponent(value: unknown): boolean {
  if (typeof value === 'function') return true

  return typeof value === 'object' && value !== null && '$$typeof' in value
}

describe('WORKSPACE_SURFACE_REGISTRY', () => {
  it('为每个表面提供可渲染的图标与标题', () => {
    for (const id of SURFACE_IDS) {
      const descriptor = WORKSPACE_SURFACE_REGISTRY[id]

      expect(descriptor, `missing descriptor for ${id}`).toBeDefined()
      expect(isRenderableComponent(descriptor.icon), `icon for ${id} is not renderable`).toBe(true)
      expect(descriptor.title.length).toBeGreaterThan(0)
      expect(descriptor.description.length).toBeGreaterThan(0)
    }
  })

  it('不包含已废弃的 data / pages 表面', () => {
    expect(Object.keys(WORKSPACE_SURFACE_REGISTRY)).not.toContain('data')

    /* 画布不是 surface：它是被文档占据的那一格，空态是一等的 start 标签。 */
    expect(Object.keys(WORKSPACE_SURFACE_REGISTRY)).not.toContain('pages')
  })

  it('导航顺序只引用注册表中存在的表面，且不重复', () => {
    for (const navigationId of WORKSPACE_NAVIGATION_ORDER) {
      const descriptor = describeWorkspaceNavigation(navigationId)

      expect(descriptor).toBeDefined()
      expect(descriptor.title.length).toBeGreaterThan(0)
      expect(descriptor.description.length).toBeGreaterThan(0)
    }

    expect(new Set(WORKSPACE_NAVIGATION_ORDER).size).toBe(WORKSPACE_NAVIGATION_ORDER.length)
  })
})
