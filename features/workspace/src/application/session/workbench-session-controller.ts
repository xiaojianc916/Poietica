import type {
  ActiveCanvasViewModel,
  CanvasSessionId,
  CanvasTabStatus,
  CanvasTabViewModel,
  CreateCanvasRequest,
  OpenWorkspaceSurfaceRequest,
  StartSurfaceViewModel,
  StartTabViewModel,
  WorkbenchSessionStore,
  WorkbenchSurfaceViewModel,
  WorkbenchTabId,
  WorkbenchTabViewModel,
  WorkbenchViewModel,
  WorkspaceSurfaceViewModel,
  WorkspaceTabViewModel,
} from '../../contracts/public-api'
import { START_TAB_ID } from '../../contracts/public-api'

type WorkbenchEntry = StartEntry | CanvasEntry | WorkspaceEntry

interface EntryBase {
  readonly id: WorkbenchTabId
  readonly title: string
  readonly canClose: boolean
}

interface StartEntry extends EntryBase {
  readonly kind: 'start'
}

interface CanvasEntry extends EntryBase {
  readonly kind: 'canvas'
  readonly sessionId: CanvasSessionId
  readonly canvasId: string
  readonly status: CanvasTabStatus
}

interface WorkspaceEntry extends EntryBase {
  readonly kind: 'workspace'
  readonly surfaceId: import('../../contracts/public-api').WorkspaceSurfaceId
}

/**
 * Startup surface.
 *
 * The workbench opens on the AI assistant instead of an empty placeholder tab,
 * so the first frame the user sees is already a usable surface.
 *
 * The id must stay `workspace:${surfaceId}`: openWorkspaceSurface derives tab
 * ids from the surface id, so the activity rail activates this tab instead of
 * opening a duplicate one.
 */
const DEFAULT_ENTRY: WorkspaceEntry = Object.freeze({
  id: 'workspace:ai',
  kind: 'workspace',
  title: 'AI',
  canClose: true,
  surfaceId: 'ai',
})

export function createWorkbenchSessionController(): WorkbenchSessionStore {
  let entries: readonly WorkbenchEntry[] = [DEFAULT_ENTRY]
  let activeTabId = DEFAULT_ENTRY.id
  const listeners = new Set<() => void>()

  let snapshot = projectSnapshot(entries, activeTabId)

  function emit(): void {
    snapshot = projectSnapshot(entries, activeTabId)
    assertInvariants(snapshot)

    for (const listener of listeners) {
      listener()
    }
  }
  /**
   * The start tab is the canvas surface's empty state, not a permanent fixture.
   * Opening a canvas — or any workspace surface — turns that placeholder into
   * the thing that was opened, in the very slot it occupied, so the strip never
   * carries a stale empty tab beside a real one.
   */
  function openEntry(entry: WorkbenchEntry): void {
    const placeholder = entries.findIndex((candidate) => candidate.kind === 'start')

    if (placeholder < 0) {
      insertToActiveRight(entry)
      return
    }

    entries = entries.map((candidate, index) => (index === placeholder ? entry : candidate))

    activeTabId = entry.id
    emit()
  }

  function insertToActiveRight(entry: WorkbenchEntry): void {
    const activeIndex = entries.findIndex((candidate) => candidate.id === activeTabId)

    const insertionIndex = activeIndex < 0 ? entries.length : activeIndex + 1

    entries = [...entries.slice(0, insertionIndex), entry, ...entries.slice(insertionIndex)]

    activeTabId = entry.id
    emit()
  }

  function createCanvas(request: CreateCanvasRequest): void {
    const canvasId = request.canvasId ?? crypto.randomUUID()

    const sessionId = request.sessionId ?? crypto.randomUUID()

    const existing = entries.find(
      (entry) => entry.kind === 'canvas' && entry.sessionId === sessionId,
    )

    if (existing) {
      activateTab(existing.id)
      return
    }

    openEntry({
      id: `canvas:${sessionId}`,
      kind: 'canvas',
      title: request.title,
      canClose: true,
      sessionId,
      canvasId,
      status: 'clean',
    })
  }

  function openWorkspaceSurface(request: OpenWorkspaceSurfaceRequest): void {
    const tabId = `workspace:${request.surfaceId}`

    const existing = entries.find((entry) => entry.id === tabId)

    if (existing) {
      activateTab(existing.id)
      return
    }

    openEntry({
      id: tabId,
      kind: 'workspace',
      title: request.title,
      canClose: true,
      surfaceId: request.surfaceId,
    })
  }

  /*
   * 同值直接返回。文档层在每次保存与脏状态跃迁时上报，等价快照不应该被
   * 替换成新对象：useSyncExternalStore 用 Object.is 比较，换引用就等于
   * 白渲染一次。判等放在这里，读侧因此不需要任何缓存层。
   */
  function setCanvasStatus(sessionId: CanvasSessionId, status: CanvasTabStatus): void {
    const index = entries.findIndex(
      (candidate) => candidate.kind === 'canvas' && candidate.sessionId === sessionId,
    )

    const entry = entries[index]

    if (!entry || entry.kind !== 'canvas' || entry.status === status) {
      return
    }

    entries = entries.map((candidate, candidateIndex) =>
      candidateIndex === index ? { ...entry, status } : candidate,
    )

    emit()
  }

  function activateTab(tabId: WorkbenchTabId): void {
    if (tabId === activeTabId || !entries.some((entry) => entry.id === tabId)) {
      return
    }

    activeTabId = tabId
    emit()
  }

  function closeTab(tabId: WorkbenchTabId): void {
    const closingIndex = entries.findIndex((entry) => entry.id === tabId)

    if (closingIndex < 0) {
      return
    }

    const closingEntry = entries[closingIndex]

    if (!closingEntry?.canClose) {
      return
    }

    const wasActive = tabId === activeTabId

    entries = entries.filter((entry) => entry.id !== tabId)

    if (wasActive) {
      const nextEntry = entries[closingIndex] ?? entries[closingIndex - 1] ?? entries[0]

      if (!nextEntry) {
        entries = [DEFAULT_ENTRY]
        activeTabId = DEFAULT_ENTRY.id
      } else {
        activeTabId = nextEntry.id
      }
    }

    emit()
  }

  function moveTab(tabId: WorkbenchTabId, targetIndex: number): void {
    const sourceIndex = entries.findIndex((entry) => entry.id === tabId)

    if (sourceIndex < 0) {
      return
    }

    const source = entries[sourceIndex]

    if (!source || source.kind === 'start') {
      return
    }

    const minimumIndex = entries.some((candidate) => candidate.kind === 'start') ? 1 : 0
    const maximumIndex = entries.length - 1
    const boundedTarget = Math.max(minimumIndex, Math.min(maximumIndex, targetIndex))

    if (sourceIndex === boundedTarget) {
      return
    }

    /*
     * targetIndex 是这个标签最终应当所在的位置，不是它挤掉的那个邻居。
     *
     * 先移除源元素，数组就已经变短；在短数组的 targetIndex 处插入，落点正好
     * 是结果里的 targetIndex。之前这里在向右拖动时额外减一，于是每次向右拖
     * 都少落一格，而上一行 maximumIndex = entries.length - 1 明确允许的最后
     * 一格永远无法到达。夹紧上界和那个补偿不可能同时正确。
     *
     * boundedTarget 已经夹在 [minimumIndex, maximumIndex] 内，插入位置无需
     * 再取一次 max。
     */
    const mutableEntries = [...entries]
    mutableEntries.splice(sourceIndex, 1)
    mutableEntries.splice(boundedTarget, 0, source)

    entries = mutableEntries
    emit()
  }

  function activateCanvas(sessionId: CanvasSessionId): void {
    const entry = findCanvasEntry(entries, sessionId)

    if (entry) {
      activateTab(entry.id)
    }
  }

  function closeCanvas(sessionId: CanvasSessionId): void {
    const entry = findCanvasEntry(entries, sessionId)

    if (entry) {
      closeTab(entry.id)
    }
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    createCanvas,
    openWorkspaceSurface,
    activateTab,
    closeTab,
    moveTab,
    setCanvasStatus,
    activateCanvas,
    closeCanvas,
  }
}

function projectSnapshot(
  entries: readonly WorkbenchEntry[],
  activeTabId: WorkbenchTabId,
): WorkbenchViewModel {
  const activeEntry = entries.find((entry) => entry.id === activeTabId)

  if (!activeEntry) {
    throw new Error('WORKBENCH_ACTIVE_ENTRY_NOT_FOUND')
  }

  const activeSurface = projectSurface(activeEntry)

  const activeCanvas = activeSurface.kind === 'canvas' ? activeSurface : null

  return {
    activeTabId,
    activeSessionId: activeCanvas?.sessionId ?? null,
    tabs: entries.map((entry) => projectTab(entry, activeTabId)),
    activeSurface,
    activeCanvas,
  }
}

function projectTab(entry: WorkbenchEntry, activeTabId: WorkbenchTabId): WorkbenchTabViewModel {
  const common = {
    id: entry.id,
    title: entry.title,
    canClose: entry.canClose,
    isActive: entry.id === activeTabId,
  }

  switch (entry.kind) {
    case 'start': {
      const tab: StartTabViewModel = {
        ...common,
        kind: 'start',
      }

      return tab
    }

    case 'canvas': {
      const tab: CanvasTabViewModel = {
        ...common,
        kind: 'canvas',
        sessionId: entry.sessionId,
        canvasId: entry.canvasId,
        status: entry.status,
      }

      return tab
    }

    case 'workspace': {
      const tab: WorkspaceTabViewModel = {
        ...common,
        kind: 'workspace',
        surfaceId: entry.surfaceId,
      }

      return tab
    }
  }
}

function projectSurface(entry: WorkbenchEntry): WorkbenchSurfaceViewModel {
  switch (entry.kind) {
    case 'start': {
      const surface: StartSurfaceViewModel = {
        kind: 'start',
        tabId: entry.id,
      }

      return surface
    }

    case 'canvas': {
      const surface: ActiveCanvasViewModel = {
        kind: 'canvas',
        tabId: entry.id,
        sessionId: entry.sessionId,
        canvasId: entry.canvasId,
        title: entry.title,
      }

      return surface
    }

    case 'workspace': {
      const surface: WorkspaceSurfaceViewModel = {
        kind: 'workspace',
        tabId: entry.id,
        surfaceId: entry.surfaceId,
        title: entry.title,
      }

      return surface
    }
  }
}

function findCanvasEntry(
  entries: readonly WorkbenchEntry[],
  sessionId: CanvasSessionId,
): CanvasEntry | undefined {
  return entries.find(
    (entry): entry is CanvasEntry => entry.kind === 'canvas' && entry.sessionId === sessionId,
  )
}

function assertInvariants(snapshot: WorkbenchViewModel): void {
  if (snapshot.tabs.length === 0) {
    throw new Error('WORKBENCH_REQUIRES_START_TAB')
  }

  const ids = new Set(snapshot.tabs.map((tab) => tab.id))

  if (ids.size !== snapshot.tabs.length) {
    throw new Error('WORKBENCH_DUPLICATE_TAB_ID')
  }

  const startTab = snapshot.tabs.find((tab) => tab.id === START_TAB_ID)

  if (startTab && (startTab.kind !== 'start' || startTab.canClose)) {
    throw new Error('WORKBENCH_INVALID_START_TAB')
  }

  const activeTabs = snapshot.tabs.filter((tab) => tab.isActive)

  if (activeTabs.length !== 1 || activeTabs[0]?.id !== snapshot.activeTabId) {
    throw new Error('WORKBENCH_ACTIVE_TAB_INCONSISTENT')
  }

  if (snapshot.activeSurface.tabId !== snapshot.activeTabId) {
    throw new Error('WORKBENCH_ACTIVE_SURFACE_INCONSISTENT')
  }

  if (snapshot.activeSurface.kind === 'canvas') {
    if (
      snapshot.activeCanvas?.tabId !== snapshot.activeTabId ||
      snapshot.activeSessionId !== snapshot.activeSurface.sessionId
    ) {
      throw new Error('WORKBENCH_ACTIVE_CANVAS_INCONSISTENT')
    }

    return
  }

  if (snapshot.activeCanvas !== null || snapshot.activeSessionId !== null) {
    throw new Error('WORKBENCH_NON_CANVAS_STATE_INCONSISTENT')
  }
}
