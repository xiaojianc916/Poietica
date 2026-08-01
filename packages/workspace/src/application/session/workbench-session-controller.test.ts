import { describe, expect, it } from 'vitest'

import { createWorkbenchSessionController } from './workbench-session-controller'

describe('workbench session controller', () => {
  it('starts on the AI workspace surface', () => {
    const store = createWorkbenchSessionController()

    expect(store.getSnapshot()).toMatchObject({
      activeTabId: 'workspace:ai',
      activeSurface: {
        kind: 'workspace',
        tabId: 'workspace:ai',
        surfaceId: 'ai',
        title: '新建对话',
      },
      tabs: [
        {
          id: 'workspace:ai',
          kind: 'workspace',
          surfaceId: 'ai',
          title: '新建对话',
          canClose: true,
          isActive: true,
        },
      ],
    })
  })

  it('opens new tabs immediately right of active tab', () => {
    const store = createWorkbenchSessionController()

    store.openConversationInNewTab({
      threadId: 'thread-1',
      title: 'One',
    })

    store.activateTab('workspace:ai')

    store.openWorkspaceSurface({
      surfaceId: 'tools',
      title: 'Tool',
    })

    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual([
      'workspace:ai',
      'workspace:tools',
      'conversation:thread-1',
    ])
  })

  it('deduplicates singleton workspace surfaces', () => {
    const store = createWorkbenchSessionController()

    store.openWorkspaceSurface({
      surfaceId: 'search',
      title: '搜索',
    })

    store.openWorkspaceSurface({
      surfaceId: 'search',
      title: '搜索',
    })

    expect(store.getSnapshot().tabs.filter((tab) => tab.id === 'workspace:search')).toHaveLength(1)
  })

  it('selects the right adjacent tab after closing active', () => {
    const store = createWorkbenchSessionController()

    store.openWorkspaceSurface({
      surfaceId: 'tools',
      title: 'Tool',
    })

    store.openWorkspaceSurface({
      surfaceId: 'search',
      title: '搜索',
    })

    store.activateTab('workspace:tools')
    store.closeTab('workspace:tools')

    expect(store.getSnapshot().activeTabId).toBe('workspace:search')
  })

  it('selects the left adjacent tab when closing the last tab', () => {
    const store = createWorkbenchSessionController()

    store.openWorkspaceSurface({
      surfaceId: 'tools',
      title: 'Tool',
    })

    store.closeTab('workspace:tools')

    expect(store.getSnapshot().activeTabId).toBe('workspace:ai')
  })

  it('moves tabs including the default surface tab', () => {
    const store = createWorkbenchSessionController()

    store.openWorkspaceSurface({
      surfaceId: 'tools',
      title: 'Tool',
    })

    store.openWorkspaceSurface({
      surfaceId: 'search',
      title: '搜索',
    })

    store.moveTab('workspace:search', 1)

    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual([
      'workspace:ai',
      'workspace:search',
      'workspace:tools',
    ])

    store.moveTab('workspace:ai', 2)

    expect(store.getSnapshot().tabs[2]?.id).toBe('workspace:ai')
  })

  it('drops the tab of a deleted conversation and lands on a neighbour', () => {
    const store = createWorkbenchSessionController()

    store.openConversationInNewTab({ threadId: 'thread-1', title: 'One' })
    store.openConversationInNewTab({ threadId: 'thread-2', title: 'Two' })
    store.activateTab('conversation:thread-1')

    store.closeConversation('thread-1')

    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual([
      'workspace:ai',
      'conversation:thread-2',
    ])
    expect(store.getSnapshot().activeTabId).toBe('conversation:thread-2')
  })

  it('falls back to the conversation entry when the last tab is deleted', () => {
    const store = createWorkbenchSessionController()

    store.openConversation({ threadId: 'thread-1', title: 'One' })

    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual(['conversation:thread-1'])

    store.closeConversation('thread-1')

    expect(store.getSnapshot()).toMatchObject({
      activeTabId: 'workspace:ai',
      activeSurface: { kind: 'workspace', surfaceId: 'ai' },
    })
  })
})
