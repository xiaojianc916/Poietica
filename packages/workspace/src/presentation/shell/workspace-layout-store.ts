import { warn } from '@poietica/observability'
import { useSyncExternalStore } from 'react'
import * as v from 'valibot'

import { WORKSPACE_LAYOUT } from './workspace-layout'

/**
 * 工作区布局状态的唯一所有者。
 *
 * 可见性与宽度是跨会话保留的产品状态，isResizing 是单次拖拽内的瞬时状态。
 * 两者都在这里：拖拽态曾经同时存在于 useSidebarResize 与 WorkspaceShell 的
 * 两个 useState 里，靠 onResizeStart / onResizeEnd 两个 prop 手工对齐，
 * 那是两份真相而不是一份加一个通道。
 */
export interface WorkspaceLayoutState {
  readonly sidebarOpen: boolean
  readonly sidebarWidth: number
  readonly isResizing: boolean
}

const STORAGE_KEY = 'poietica.workspace.layout.v1'

const DEFAULT_STATE: WorkspaceLayoutState = {
  sidebarOpen: true,
  sidebarWidth: WORKSPACE_LAYOUT.sidebar.defaultWidth,
  isResizing: false,
}

function clampSidebarWidth(width: number): number {
  return Math.min(
    WORKSPACE_LAYOUT.sidebar.maxWidth,
    Math.max(WORKSPACE_LAYOUT.sidebar.minWidth, Math.round(width)),
  )
}

/*
 * 持久化形状由 schema 声明，逐字段兜底交给 valibot。
 * 此前是三个手写的 typeof 三元，每加一个字段就多一段同构的校验代码。
 */
const PersistedLayoutSchema = v.object({
  sidebarOpen: v.fallback(v.boolean(), DEFAULT_STATE.sidebarOpen),
  sidebarWidth: v.fallback(
    v.pipe(v.number(), v.finite(), v.transform(clampSidebarWidth)),
    DEFAULT_STATE.sidebarWidth,
  ),
})

function readPersistedState(): WorkspaceLayoutState {
  const raw = globalThis.localStorage?.getItem(STORAGE_KEY)

  if (!raw) {
    return DEFAULT_STATE
  }

  try {
    return { ...v.parse(PersistedLayoutSchema, JSON.parse(raw)), isResizing: false }
  } catch (cause) {
    // 存储内容不可信时回退到产品默认布局，而不是让整个外壳启动失败。
    warn('workspace-layout', '忽略无法解析的持久化布局', cause)

    return DEFAULT_STATE
  }
}

class WorkspaceLayoutStore {
  #state: WorkspaceLayoutState = readPersistedState()

  #listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  getSnapshot = (): WorkspaceLayoutState => this.#state

  setSidebarOpen = (open: boolean): void => {
    this.#commit({ sidebarOpen: open })
  }

  toggleSidebar = (): void => {
    this.#commit({ sidebarOpen: !this.#state.sidebarOpen })
  }

  setSidebarWidth = (width: number): void => {
    this.#commit({ sidebarWidth: clampSidebarWidth(width) })
  }

  setResizing = (resizing: boolean): void => {
    this.#commit({ isResizing: resizing })
  }

  #commit(patch: Partial<WorkspaceLayoutState>): void {
    const next: WorkspaceLayoutState = { ...this.#state, ...patch }

    if (
      next.sidebarOpen === this.#state.sidebarOpen &&
      next.sidebarWidth === this.#state.sidebarWidth &&
      next.isResizing === this.#state.isResizing
    ) {
      return
    }

    this.#state = next

    for (const listener of this.#listeners) {
      listener()
    }

    /*
     * 只在离散的用户意图落定时写盘。拖拽期间每一帧都会提交宽度，但松手那一次
     * 提交本身就把 isResizing 置回 false，最终宽度随之落盘——因此不需要
     * requestAnimationFrame 合并、不需要定时器、也不需要"无 rAF 环境"分支。
     * 那个分支此前会让持久化在该环境下永久静默失效。
     */
    if (!next.isResizing) {
      this.#persist()
    }
  }

  #persist(): void {
    const { isResizing: _isResizing, ...persisted } = this.#state

    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch (cause) {
      // 存储不可用（配额或隐私模式）只影响下次启动的还原，不影响本次会话。
      warn('workspace-layout', '无法持久化布局', cause)
    }
  }
}

/*
 * 本模块只拥有用户意图，不拥有视口：窄视口改用抽屉属于呈现降级，由渲染层
 * 从布局模式派生。意图一旦被环境覆盖就再也还原不回来。
 */
export const workspaceLayoutStore = new WorkspaceLayoutStore()

export function useWorkspaceLayoutState(): WorkspaceLayoutState {
  return useSyncExternalStore(
    workspaceLayoutStore.subscribe,
    workspaceLayoutStore.getSnapshot,
    workspaceLayoutStore.getSnapshot,
  )
}
