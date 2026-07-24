import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createWorkbenchSessionController } from './workbench-session-controller'

beforeEach(() => {
  let id = 0

  vi.stubGlobal('crypto', {
    randomUUID: () => `generated-${String(++id)}`,
  })
})

describe('workbench session controller', () => {
  it('starts with a tab-driven new-tab surface', () => {
    const store = createWorkbenchSessionController()

    expect(store.getSnapshot()).toMatchObject({
      activeTabId: 'workbench:start',
      activeSurface: {
        kind: 'start',
        tabId: 'workbench:start',
      },
      tabs: [
        {
          id: 'workbench:start',
          kind: 'start',
          title: '新标签页',
          canClose: false,
          isActive: true,
        },
      ],
    })
  })

  it('opens new tabs immediately right of active tab', () => {
    const store = createWorkbenchSessionController()

    store.createCanvas({
      canvasId: 'canvas-1',
      sessionId: 'session-1',
      title: 'One',
    })

    store.activateTab('workbench:start')

    store.openWorkspaceSurface({
      surfaceId: 'assets',
      title: '素材',
    })

    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual([
      'workbench:start',
      'workspace:assets',
      'canvas:session-1',
    ])
  })

  it('deduplicates singleton workspace surfaces', () => {
    const store = createWorkbenchSessionController()

    store.openWorkspaceSurface({
      surfaceId: 'relations',
      title: '关系',
    })

    store.openWorkspaceSurface({
      surfaceId: 'relations',
      title: '关系',
    })

    expect(store.getSnapshot().tabs.filter((tab) => tab.id === 'workspace:relations')).toHaveLength(
      1,
    )
  })

  it('selects the right adjacent tab after closing active', () => {
    const store = createWorkbenchSessionController()

    store.openWorkspaceSurface({
      surfaceId: 'assets',
      title: '素材',
    })

    store.openWorkspaceSurface({
      surfaceId: 'relations',
      title: '关系',
    })

    store.activateTab('workspace:assets')
    store.closeTab('workspace:assets')

    expect(store.getSnapshot().activeTabId).toBe('workspace:relations')
  })

  it('selects the left adjacent tab when closing the last tab', () => {
    const store = createWorkbenchSessionController()

    store.openWorkspaceSurface({
      surfaceId: 'assets',
      title: '素材',
    })

    store.closeTab('workspace:assets')

    expect(store.getSnapshot().activeTabId).toBe('workbench:start')
  })

  it('moves tabs without moving the permanent new-tab entry', () => {
    const store = createWorkbenchSessionController()

    store.openWorkspaceSurface({
      surfaceId: 'assets',
      title: '素材',
    })

    store.openWorkspaceSurface({
      surfaceId: 'relations',
      title: '关系',
    })

    store.moveTab('workspace:relations', 1)

    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual([
      'workbench:start',
      'workspace:relations',
      'workspace:assets',
    ])

    store.moveTab('workbench:start', 2)

    expect(store.getSnapshot().tabs[0]?.id).toBe('workbench:start')
  })

  it('keeps canvas document commands at the boundary', () => {
    const store = createWorkbenchSessionController()

    store.createCanvas({
      canvasId: 'canvas-1',
      sessionId: 'session-1',
      title: 'One',
    })

    store.openWorkspaceSurface({
      surfaceId: 'assets',
      title: '素材',
    })

    store.activateCanvas('session-1')

    expect(store.getSnapshot().activeSessionId).toBe('session-1')

    store.closeCanvas('session-1')

    expect(store.getSnapshot().tabs.some((tab) => tab.id === 'canvas:session-1')).toBe(false)
  })
})
