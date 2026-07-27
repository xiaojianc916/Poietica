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

  #commit(patch: Partial<WorkspaceLayoutState>): void {
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

    this.#schedulePersist()
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

/*
 * 本模块只拥有用户意图，不拥有视口。
 *
 * 窄视口下侧边栏改为遮罩抽屉，这属于呈现降级，由 WorkspaceShell 从布局
 * 模式派生（dockSidebar 与抽屉分支）。曾经在这里追加过一份视口策略，它在
 * 模块求值阶段就执行，而那时 WebView 还没完成首次布局、宽度查询不匹配，
 * 于是每次冷启动都把侧边栏误判为应当收起，并且此后再也不会恢复。
 *
 * 把视口写进意图是方向性错误：意图一旦被环境覆盖就丢了，窗口变宽也无从
 * 还原。派生状态留在渲染层，这里只记录用户按过什么。
 */
export const workspaceLayoutStore = new WorkspaceLayoutStore()

export function useWorkspaceLayoutState(): WorkspaceLayoutState {
  return useSyncExternalStore(
    workspaceLayoutStore.subscribe,
    workspaceLayoutStore.getSnapshot,
    workspaceLayoutStore.getSnapshot,
  )
}
