import { useSyncExternalStore } from 'react'

import { WORKSPACE_LAYOUT } from './workspace-layout'
import { useWorkspaceLayoutState } from './workspace-layout-store'

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
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * 侧边栏此刻是不是真的占着那一列。
 *
 * 「停靠」要两个条件同时成立：用户想要它开着，而视口还容得下一列。store 只拥有
 * 前者 —— 窄视口改用抽屉是呈现降级，意图一旦被环境覆盖就再也还原不回来。
 *
 * 判据只在这里出现一次。外壳栅格的 data-sidebar-docked、以及标题栏里那截竖线，
 * 读的都是它：此前后者读的是裸 sidebarOpen，于是拖窄窗口自动收起时，同一条线的
 * 两段各走各的 —— 下面那段淡掉了，chrome 行那截还亮着。
 */
export function useIsSidebarDocked(): boolean {
  const mode = useWorkspaceLayoutMode()
  const { sidebarOpen } = useWorkspaceLayoutState()

  return mode !== 'narrow' && sidebarOpen
}
