import type {
  ActiveCanvasViewModel,
  CanvasSessionId,
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
}

interface WorkspaceEntry extends EntryBase {
  readonly kind: 'workspace'
  readonly surfaceId: import('../../contracts/public-api').WorkspaceSurfaceId
}

const START_ENTRY: StartEntry = Object.freeze({
  id: START_TAB_ID,
  kind: 'start',
  title: '新标签页',
  canClose: false,
})

export function createWorkbenchSessionController(): WorkbenchSessionStore {
  let entries: readonly WorkbenchEntry[] = [START_ENTRY]
  let activeTabId = START_TAB_ID
  const listeners = new Set<() => void>()

  let snapshot = projectSnapshot(entries, activeTabId)

  function emit(): void {
    snapshot = projectSnapshot(entries, activeTabId)
    assertInvariants(snapshot)

    for (const listener of listeners) {
      listener()
    }
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

    insertToActiveRight({
      id: `canvas:${sessionId}`,
      kind: 'canvas',
      title: request.title,
      canClose: true,
      sessionId,
      canvasId,
    })
  }

  function openWorkspaceSurface(request: OpenWorkspaceSurfaceRequest): void {
    const tabId = `workspace:${request.surfaceId}`

    const existing = entries.find((entry) => entry.id === tabId)

    if (existing) {
      activateTab(existing.id)
      return
    }

    insertToActiveRight({
      id: tabId,
      kind: 'workspace',
      title: request.title,
      canClose: true,
      surfaceId: request.surfaceId,
    })
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
        entries = [START_ENTRY]
        activeTabId = START_TAB_ID
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

    const minimumIndex = 1
    const maximumIndex = entries.length - 1
    const boundedTarget = Math.max(minimumIndex, Math.min(maximumIndex, targetIndex))

    if (sourceIndex === boundedTarget) {
      return
    }

    const mutableEntries = [...entries]
    mutableEntries.splice(sourceIndex, 1)

    const adjustedTarget = sourceIndex < boundedTarget ? boundedTarget - 1 : boundedTarget

    mutableEntries.splice(Math.max(minimumIndex, adjustedTarget), 0, source)

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

  if (startTab?.kind !== 'start' || startTab.canClose) {
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
