import { describe, expect, it } from 'vitest'
import {
  describeWorkspaceSurface,
  WORKSPACE_NAVIGATION_ORDER,
  WORKSPACE_SURFACE_REGISTRY,
} from './surface-registry'

/*
 * React 的组件类型不一定是函数。
 *
 * 这张注册表里的图标来自 @mynaui/icons-react，每个都被 forwardRef 包过一层，
 * 因此 typeof 是 'object'。旧断言要求它是函数，于是循环里第一个图标就失败，
 * 而所有图标其实渲染得好好的。这个测试真正关心的是 React 能否渲染这个值，
 * 而普通函数组件、forwardRef、memo 三者都满足这一点。
 */
function isRenderableComponent(value: unknown): boolean {
  if (typeof value === 'function') {
    return true
  }

  return typeof value === 'object' && value !== null && '$$typeof' in value
}

describe('WORKSPACE_SURFACE_REGISTRY', () => {
  it('为每个表面提供可渲染的图标与标题', () => {
    for (const [id, descriptor] of Object.entries(WORKSPACE_SURFACE_REGISTRY)) {
      expect(isRenderableComponent(descriptor.icon), `icon for ${id} is not renderable`).toBe(true)
      expect(descriptor.title.length).toBeGreaterThan(0)
      expect(descriptor.description.length).toBeGreaterThan(0)
    }
  })

  it('不包含已废弃的画布域表面', () => {
    const keys = Object.keys(WORKSPACE_SURFACE_REGISTRY)

    /*
     * data / pages / canvas-start 是历代旧名；documents / layers / relations /
     * assets / extensions 随画布整包移出产品。导航项与表面是同一个概念，不
     * 存在第二种导航 ID。
     */
    for (const deprecated of [
      'data',
      'pages',
      'canvas-start',
      'documents',
      'layers',
      'relations',
      'assets',
      'extensions',
    ]) {
      expect(keys).not.toContain(deprecated)
    }
  })

  it('导航顺序只引用注册表中存在的表面，且不重复', () => {
    for (const surfaceId of WORKSPACE_NAVIGATION_ORDER) {
      const descriptor = describeWorkspaceSurface(surfaceId)

      expect(descriptor).toBeDefined()
      expect(descriptor.title.length).toBeGreaterThan(0)
      expect(descriptor.description.length).toBeGreaterThan(0)
    }

    expect(new Set(WORKSPACE_NAVIGATION_ORDER).size).toBe(WORKSPACE_NAVIGATION_ORDER.length)
  })
})
