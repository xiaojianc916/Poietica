import { useSyncExternalStore } from 'react'

import { WORKSPACE_LAYOUT } from './workspace-layout'

/**
 * 工作区布局状态的唯一所有者。
 *
 * 侧边栏与属性栏的可见性、宽度是跨会话保留的产品状态，并且必须能被
 * 命令面板和快捷键驱动，因此它不属于任何一个渲染组件的 useState。
 */
export interface WorkspaceLayoutState {
  readonly sidebarOpen: boolean
  readonly sidebarWidth: number
  readonly inspectorOpen: boolean
}

const STORAGE_KEY = 'poietica.workspace.layout.v1'

const DEFAULT_STATE: WorkspaceLayoutState = {
  sidebarOpen: true,
  sidebarWidth: WORKSPACE_LAYOUT.sidebar.defaultWidth,
  inspectorOpen: true,
}

function clampSidebarWidth(width: number): number {
  return Math.min(
    WORKSPACE_LAYOUT.sidebar.maxWidth,
    Math.max(WORKSPACE_LAYOUT.sidebar.minWidth, Math.round(width)),
  )
}

function readPersistedState(): WorkspaceLayoutState {
  const raw = globalThis.localStorage?.getItem(STORAGE_KEY)

  if (!raw) {
    return DEFAULT_STATE
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    // 存储内容不可信时回退到产品默认布局，而不是让整个外壳启动失败。
    console.warn('[workspace-layout] 忽略无法解析的持久化布局', cause)

    return DEFAULT_STATE
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return DEFAULT_STATE
  }

  const candidate = parsed as Partial<Record<keyof WorkspaceLayoutState, unknown>>

  return {
    sidebarOpen:
      typeof candidate.sidebarOpen === 'boolean'
        ? candidate.sidebarOpen
        : DEFAULT_STATE.sidebarOpen,
    sidebarWidth:
      typeof candidate.sidebarWidth === 'number' && Number.isFinite(candidate.sidebarWidth)
        ? clampSidebarWidth(candidate.sidebarWidth)
        : DEFAULT_STATE.sidebarWidth,
    inspectorOpen:
      typeof candidate.inspectorOpen === 'boolean'
        ? candidate.inspectorOpen
        : DEFAULT_STATE.inspectorOpen,
  }
}

class WorkspaceLayoutStore {
  #state: WorkspaceLayoutState = readPersistedState()

  #listeners = new Set<() => void>()

  #persistFrame: number | null = null

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

  setInspectorOpen = (open: boolean): void => {
    this.#commit({ inspectorOpen: open })
  }

  toggleInspector = (): void => {
    this.#commit({ inspectorOpen: !this.#state.inspectorOpen })
  }

  /*
   * 窄视口降级不是用户意图，因此不写回存储：窗口重新变宽时，用户此前
   * 选择的侧边栏状态必须原样回来。
   */
  collapseForNarrowViewport = (): void => {
    this.#commit({ sidebarOpen: false }, false)
  }

  #commit(patch: Partial<WorkspaceLayoutState>, persist = true): void {
    const next: WorkspaceLayoutState = { ...this.#state, ...patch }

    if (
      next.sidebarOpen === this.#state.sidebarOpen &&
      next.sidebarWidth === this.#state.sidebarWidth &&
      next.inspectorOpen === this.#state.inspectorOpen
    ) {
      return
    }

    this.#state = next

    for (const listener of this.#listeners) {
      listener()
    }

    if (persist) {
      this.#schedulePersist()
    }
  }

  /*
   * 拖动分隔条时每一帧都会提交宽度。写盘合并到一帧，避免同步存储 I/O
   * 落在指针事件的关键路径上。
   */
  #schedulePersist(): void {
    if (this.#persistFrame !== null || typeof requestAnimationFrame !== 'function') {
      return
    }

    this.#persistFrame = requestAnimationFrame(() => {
      this.#persistFrame = null

      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.#state))
      } catch (cause) {
        // 存储不可用（配额或隐私模式）只影响下次启动的还原，不影响本次会话。
        console.warn('[workspace-layout] 无法持久化布局', cause)
      }
    })
  }
}

export const workspaceLayoutStore = new WorkspaceLayoutStore()

/*
 * 窄视口下侧边栏是遮罩抽屉。进入窄视口时收起，避免抽屉在冷启动或窗口
 * 缩小后直接盖住画布。这条策略属于布局本身，所以绑定在 store 的媒体
 * 查询边界上，而不是散落在渲染组件的 effect 里 —— 后者在首帧无法生效。
 */
if (typeof window !== 'undefined') {
  const compact = window.matchMedia(WORKSPACE_LAYOUT.breakpoints.compact)

  const applyNarrowPolicy = () => {
    if (!compact.matches) {
      workspaceLayoutStore.collapseForNarrowViewport()
    }
  }

  applyNarrowPolicy()

  compact.addEventListener('change', applyNarrowPolicy)
}

export function useWorkspaceLayoutState(): WorkspaceLayoutState {
  return useSyncExternalStore(
    workspaceLayoutStore.subscribe,
    workspaceLayoutStore.getSnapshot,
    workspaceLayoutStore.getSnapshot,
  )
}
