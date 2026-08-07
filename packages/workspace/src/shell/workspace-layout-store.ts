import { createExternalStore, createPreference } from '@poietica/core'
import { warn } from '@poietica/observability'
import { useSyncExternalStore } from 'react'
import * as v from 'valibot'

import { WORKSPACE_LAYOUT } from './workspace-layout'

/**
 * 工作区布局状态的唯一所有者。
 *
 * 可见性与宽度是跨会话保留的产品状态，isResizing 是单次拖拽内的瞬时状态。
 * 两者都在这里：拖拽态一旦散进组件本地态就成了两份真相，而不是一份加一个通道。
 */
export interface WorkspaceLayoutState {
  readonly sidebarOpen: boolean
  readonly sidebarWidth: number
  readonly isResizing: boolean
}

/** 落盘的只有意图，不含瞬时的拖拽态。 */
interface LayoutIntent {
  readonly sidebarOpen: boolean
  readonly sidebarWidth: number
}

const DEFAULT_INTENT: LayoutIntent = {
  sidebarOpen: true,
  sidebarWidth: WORKSPACE_LAYOUT.sidebar.defaultWidth,
}

function clampSidebarWidth(width: number): number {
  return Math.min(
    WORKSPACE_LAYOUT.sidebar.maxWidth,
    Math.max(WORKSPACE_LAYOUT.sidebar.minWidth, Math.round(width)),
  )
}

/* 持久化形状由 schema 声明，逐字段兜底交给 valibot，不手写 typeof 校验。 */
const PersistedLayoutSchema = v.object({
  sidebarOpen: v.fallback(v.boolean(), DEFAULT_INTENT.sidebarOpen),
  sidebarWidth: v.fallback(
    v.pipe(v.number(), v.finite(), v.transform(clampSidebarWidth)),
    DEFAULT_INTENT.sidebarWidth,
  ),
})

const FAILURE = {
  read: '读不出布局偏好，回到默认布局',
  write: '写不进布局偏好，下次启动回到默认布局',
}

const persisted = createPreference<LayoutIntent>({
  key: 'poietica.workspace.layout.v1',
  fallback: DEFAULT_INTENT,
  decode: (raw) => v.parse(PersistedLayoutSchema, JSON.parse(raw)),
  encode: (value) => JSON.stringify(value),
  onFailure: ({ stage, cause }) => {
    warn(FAILURE[stage], { scope: 'workspace-layout', cause })
  },
})

/*
 * 本模块只拥有用户意图，不拥有视口：窄视口改用抽屉属于呈现降级，由渲染层
 * 从布局模式派生。意图一旦被环境覆盖就再也还原不回来。
 */
let intent = persisted.read()
let resizing = false
let snapshot: WorkspaceLayoutState = { ...intent, isResizing: false }

function publish(): void {
  const next: WorkspaceLayoutState = { ...intent, isResizing: resizing }

  if (
    next.sidebarOpen === snapshot.sidebarOpen &&
    next.sidebarWidth === snapshot.sidebarWidth &&
    next.isResizing === snapshot.isResizing
  ) {
    return
  }

  snapshot = next
  store.notify()
}

/* 另一个窗口改了同一份布局：意图以那一侧为准，本侧的拖拽态不受影响。 */
function adopt(): void {
  intent = persisted.read()
  publish()
}

const store = createExternalStore<WorkspaceLayoutState>({
  read: () => snapshot,
  activate: () => persisted.subscribe(adopt),
})

/*
 * 只在离散的用户意图落定时写盘。拖拽期间每一帧都会提交宽度，但松手那一次由
 * setResizing 收尾，最终宽度随之落盘 —— 因此不需要 requestAnimationFrame
 * 合并，也不需要定时器。
 */
function settle(next: LayoutIntent): void {
  if (next.sidebarOpen === intent.sidebarOpen && next.sidebarWidth === intent.sidebarWidth) {
    return
  }

  intent = next
  publish()

  if (!resizing) {
    persisted.write(next)
  }
}

export const workspaceLayoutStore = {
  subscribe: store.subscribe,
  getSnapshot: (): WorkspaceLayoutState => snapshot,
  setSidebarOpen: (open: boolean): void => {
    settle({ ...intent, sidebarOpen: open })
  },
  toggleSidebar: (): void => {
    settle({ ...intent, sidebarOpen: !intent.sidebarOpen })
  },
  setSidebarWidth: (width: number): void => {
    settle({ ...intent, sidebarWidth: clampSidebarWidth(width) })
  },
  setResizing: (value: boolean): void => {
    if (value === resizing) {
      return
    }

    resizing = value
    publish()

    /* 松手那一刻，把拖拽期间累积的宽度一次落盘。 */
    if (!value) {
      persisted.write(intent)
    }
  },
}

export function useWorkspaceLayoutState(): WorkspaceLayoutState {
  return useSyncExternalStore(store.subscribe, store.read, store.read)
}
