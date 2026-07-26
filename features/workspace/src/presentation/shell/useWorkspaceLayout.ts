import { useSyncExternalStore } from 'react'

import { WORKSPACE_LAYOUT } from './workspace-layout'

export type WorkspaceLayoutMode = 'wide' | 'compact' | 'narrow'

/*
 * MediaQueryList 按查询串缓存：getSnapshot 会被频繁调用，不应每次都新建
 * 一个 MediaQueryList。惰性创建同时让本模块在无 DOM 的测试环境中可导入。
 */
const queryCache = new Map<string, MediaQueryList>()

function mediaQuery(query: string): MediaQueryList {
  const cached = queryCache.get(query)

  if (cached) {
    return cached
  }

  const created = window.matchMedia(query)

  queryCache.set(query, created)

  return created
}

function getSnapshot(): WorkspaceLayoutMode {
  if (mediaQuery(WORKSPACE_LAYOUT.breakpoints.wide).matches) {
    return 'wide'
  }

  if (mediaQuery(WORKSPACE_LAYOUT.breakpoints.compact).matches) {
    return 'compact'
  }

  return 'narrow'
}

function getServerSnapshot(): WorkspaceLayoutMode {
  return 'wide'
}

function subscribe(listener: () => void): () => void {
  const queries = [
    mediaQuery(WORKSPACE_LAYOUT.breakpoints.wide),
    mediaQuery(WORKSPACE_LAYOUT.breakpoints.compact),
  ]

  for (const query of queries) {
    query.addEventListener('change', listener)
  }

  return () => {
    for (const query of queries) {
      query.removeEventListener('change', listener)
    }
  }
}

export function useWorkspaceLayoutMode(): WorkspaceLayoutMode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
