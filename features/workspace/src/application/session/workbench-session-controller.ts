import type {
  OpenWorkspaceSurfaceRequest,
  WorkbenchSessionStore,
  WorkbenchSurfaceViewModel,
  WorkbenchTabId,
  WorkbenchTabViewModel,
  WorkbenchViewModel,
  WorkspaceSurfaceId,
  WorkspaceSurfaceViewModel,
  WorkspaceTabViewModel,
} from '@poietica/features-workspace/contracts'
import { CONVERSATION_ENTRY_TITLE } from '@poietica/features-workspace/contracts'
import type {
  ActiveConversationViewModel,
  ConversationId,
  ConversationTabViewModel,
  OpenConversationRequest,
} from '../../contracts/workbench-contract'

type WorkbenchEntry = ConversationEntry | WorkspaceEntry

interface EntryBase {
  readonly id: WorkbenchTabId
  readonly title: string
  readonly canClose: boolean
}

interface ConversationEntry extends EntryBase {
  readonly kind: 'conversation'
  readonly threadId: ConversationId
}

interface WorkspaceEntry extends EntryBase {
  readonly kind: 'workspace'
  readonly surfaceId: WorkspaceSurfaceId
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
  title: CONVERSATION_ENTRY_TITLE,
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
  function insertToActiveRight(entry: WorkbenchEntry): void {
    const activeIndex = entries.findIndex((candidate) => candidate.id === activeTabId)

    const insertionIndex = activeIndex < 0 ? entries.length : activeIndex + 1

    entries = [...entries.slice(0, insertionIndex), entry, ...entries.slice(insertionIndex)]

    activeTabId = entry.id
    emit()
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

  /*
   * 会话槽：正在看的那一格如果本身就是 AI，就地变成这条对话。
   *
   * 启动时的 workspace:ai 也算 AI 那一格，所以点侧栏第一行不会并排开出第二
   * 格；已经开着的对话只激活，列表点两次不会有两格同名。
   */
  function openConversation(request: OpenConversationRequest): void {
    const existing = findConversationEntry(entries, request.threadId)

    if (existing) {
      activateTab(existing.id)
      return
    }

    const entry = conversationEntry(request)
    const slot = entries.findIndex((candidate) => candidate.id === activeTabId)
    const active = entries[slot]
    const replaceable =
      active?.kind === 'conversation' || (active?.kind === 'workspace' && active.surfaceId === 'ai')

    if (!active || !replaceable) {
      insertToActiveRight(entry)
      return
    }

    entries = entries.map((candidate, index) => (index === slot ? entry : candidate))
    activeTabId = entry.id
    emit()
  }

  function openConversationInNewTab(request: OpenConversationRequest): void {
    const existing = findConversationEntry(entries, request.threadId)

    if (existing) {
      activateTab(existing.id)
      return
    }

    insertToActiveRight(conversationEntry(request))
  }

  function setConversationTitle(threadId: ConversationId, title: string): void {
    const index = entries.findIndex(
      (candidate) => candidate.kind === 'conversation' && candidate.threadId === threadId,
    )

    const entry = entries[index]

    if (entry?.kind !== 'conversation' || entry.title === title) {
      return
    }

    entries = entries.map((candidate, candidateIndex) =>
      candidateIndex === index ? { ...entry, title } : candidate,
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

    if (!source) {
      return
    }

    /* 没有被钉住的标签：任何一格都能拖到任何位置，包括最左端。 */
    const boundedTarget = Math.max(0, Math.min(entries.length - 1, targetIndex))

    if (sourceIndex === boundedTarget) {
      return
    }

    /*
     * targetIndex 是这个标签最终应当所在的位置，不是它挤掉的那个邻居。
     *
     * 先移除源元素，数组就已经变短；在短数组的 targetIndex 处插入，落点正好
     * 是结果里的 targetIndex。之前这里在向右拖动时额外减一，于是每次向右拖
     * 都少落一格，而上界 entries.length - 1 明确允许的最后一格永远无法到达。
     * 夹紧上界和那个补偿不可能同时正确。
     *
     * boundedTarget 已经夹在 [0, entries.length - 1] 内，插入位置无需再取一次 max。
     */
    const mutableEntries = [...entries]
    mutableEntries.splice(sourceIndex, 1)
    mutableEntries.splice(boundedTarget, 0, source)

    entries = mutableEntries
    emit()
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    openWorkspaceSurface,
    openConversation,
    openConversationInNewTab,
    setConversationTitle,
    activateTab,
    closeTab,
    moveTab,
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

  return {
    activeTabId,
    tabs: entries.map((entry) => projectTab(entry, activeTabId)),
    activeSurface: projectSurface(activeEntry),
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
    case 'conversation': {
      const tab: ConversationTabViewModel = {
        ...common,
        kind: 'conversation',
        threadId: entry.threadId,
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
    case 'conversation': {
      const surface: ActiveConversationViewModel = {
        kind: 'conversation',
        tabId: entry.id,
        threadId: entry.threadId,
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

function conversationEntry(request: OpenConversationRequest): ConversationEntry {
  return {
    id: `conversation:${request.threadId}`,
    kind: 'conversation',
    title: request.title,
    canClose: true,
    threadId: request.threadId,
  }
}

function findConversationEntry(
  entries: readonly WorkbenchEntry[],
  threadId: ConversationId,
): ConversationEntry | undefined {
  return entries.find(
    (entry): entry is ConversationEntry =>
      entry.kind === 'conversation' && entry.threadId === threadId,
  )
}

function assertInvariants(snapshot: WorkbenchViewModel): void {
  /* 判的是"至少有一个标签"。 */
  if (snapshot.tabs.length === 0) {
    throw new Error('WORKBENCH_REQUIRES_TAB')
  }

  const ids = new Set(snapshot.tabs.map((tab) => tab.id))

  if (ids.size !== snapshot.tabs.length) {
    throw new Error('WORKBENCH_DUPLICATE_TAB_ID')
  }

  const activeTabs = snapshot.tabs.filter((tab) => tab.isActive)

  if (activeTabs.length !== 1 || activeTabs[0]?.id !== snapshot.activeTabId) {
    throw new Error('WORKBENCH_ACTIVE_TAB_INCONSISTENT')
  }

  if (snapshot.activeSurface.tabId !== snapshot.activeTabId) {
    throw new Error('WORKBENCH_ACTIVE_SURFACE_INCONSISTENT')
  }

}
