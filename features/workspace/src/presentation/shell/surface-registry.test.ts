import { describe, expect, it } from 'vitest'

import type { WorkspaceSurfaceId } from '../../contracts/workbench-contract'
import { WORKSPACE_SURFACE_REGISTRY } from './surface-registry'

const SURFACE_IDS: readonly WorkspaceSurfaceId[] = [
  'pages',
  'documents',
  'search',
  'layers',
  'relations',
  'ai',
  'assets',
  'extensions',
]

describe('WORKSPACE_SURFACE_REGISTRY', () => {
  it('为每个表面提供可渲染的图标与标题', () => {
    for (const id of SURFACE_IDS) {
      const descriptor = WORKSPACE_SURFACE_REGISTRY[id]

      expect(descriptor, `missing descriptor for ${id}`).toBeDefined()
      expect(typeof descriptor.icon).toBe('function')
      expect(descriptor.title.length).toBeGreaterThan(0)
    }
  })

  it('不包含已废弃的 data 表面', () => {
    expect(Object.keys(WORKSPACE_SURFACE_REGISTRY)).not.toContain('data')
  })
})
