import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createWorkbenchSessionController } from './workbench-session-controller'

beforeEach(() => {
  let id = 0

  vi.stubGlobal('crypto', {
    randomUUID: () => `generated-${String(++id)}`,
  })
})

describe('workbench session controller', () => {
  it('starts on the AI workspace surface', () => {
    const store = createWorkbenchSessionController()

    expect(store.getSnapshot()).toMatchObject({
      activeTabId: 'workspace:ai',
      activeSurface: {
        kind: 'workspace',
        tabId: 'workspace:ai',
        surfaceId: 'ai',
        title: '新建会话',
      },
      tabs: [
        {
          id: 'workspace:ai',
          kind: 'workspace',
          surfaceId: 'ai',
          title: '新建会话',
          canClose: true,
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

    store.activateTab('workspace:ai')

    store.openWorkspaceSurface({
      surfaceId: 'assets',
      title: '素材',
    })

    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual([
      'workspace:ai',
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

    expect(store.getSnapshot().activeTabId).toBe('workspace:ai')
  })

  it('moves tabs including the default surface tab', () => {
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
      'workspace:ai',
      'workspace:relations',
      'workspace:assets',
    ])

    store.moveTab('workspace:ai', 2)

    expect(store.getSnapshot().tabs[2]?.id).toBe('workspace:ai')
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

  it('画布就地顶掉起始页，标签总数不变', () => {
    const store = createWorkbenchSessionController()

    store.openCanvasStart()

    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual([
      'workspace:ai',
      'workbench:start',
    ])

    store.createCanvas({
      canvasId: 'canvas-1',
      sessionId: 'session-1',
      title: 'One',
    })

    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual([
      'workspace:ai',
      'canvas:session-1',
    ])

    expect(store.getSnapshot().activeSurface).toMatchObject({
      kind: 'canvas',
      tabId: 'canvas:session-1',
    })
  })

  it('起始页唯一，且不被其它表面吞掉', () => {
    const store = createWorkbenchSessionController()

    store.openCanvasStart()
    store.openCanvasStart()

    expect(store.getSnapshot().tabs.filter((tab) => tab.kind === 'start')).toHaveLength(1)

    store.openWorkspaceSurface({
      surfaceId: 'assets',
      title: '素材',
    })

    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual([
      'workspace:ai',
      'workbench:start',
      'workspace:assets',
    ])
  })

  it('起始页可关闭也可拖动', () => {
    const store = createWorkbenchSessionController()

    store.openCanvasStart()
    store.moveTab('workbench:start', 0)

    expect(store.getSnapshot().tabs[0]?.id).toBe('workbench:start')

    store.closeTab('workbench:start')

    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual(['workspace:ai'])
  })
})
