import { warn } from '@poietica/observability'

import type { PersistedWorkbenchState, WorkbenchStatePort } from '../contracts/persistence'
import type {
  ActiveConversationViewModel,
  ConversationId,
  OpenConversationRequest,
  OpenWorkspaceSurfaceRequest,
  WorkbenchSessionStore,
  WorkbenchSurfaceViewModel,
  WorkbenchTabId,
  WorkbenchTabViewModel,
  WorkbenchViewModel,
  WorkspaceSurfaceViewModel,
} from '../contracts/workbench'
import {
  CONVERSATION_ENTRY_TITLE,
  DEFAULT_SURFACE_ID,
  describeWorkspaceSurface,
  type WorkspaceSurfaceId,
} from '../domain/index'

type Entry = ConversationEntry | WorkspaceEntry

interface ConversationEntry {
  readonly kind: 'conversation'
  readonly threadId: ConversationId
  readonly title: string
}

interface WorkspaceEntry {
  readonly kind: 'workspace'
  readonly surfaceId: WorkspaceSurfaceId
}

/**
 * 工作台状态。
 *
 * 活动标签由索引持有，不是第二个 id 字段：只要 tabs 非空、activeIndex 落在
 * 界内，「恰好一个 active」就是结构性的真，不可能不成立。此前 activeTabId 与
 * entries 是两个独立可变量，四条运行时不变量就是为了看住它们对不上的那一刻。
 */
interface WorkbenchState {
  readonly entries: readonly Entry[]
  readonly activeIndex: number
}

const DEFAULT_ENTRY: WorkspaceEntry = { kind: 'workspace', surfaceId: DEFAULT_SURFACE_ID }

const INITIAL_STATE: WorkbenchState = { entries: [DEFAULT_ENTRY], activeIndex: 0 }

function entryId(entry: Entry): WorkbenchTabId {
  return entry.kind === 'conversation'
    ? `conversation:${entry.threadId}`
    : `workspace:${entry.surfaceId}`
}

function entryTitle(entry: Entry): string {
  return entry.kind === 'conversation'
    ? entry.title
    : describeWorkspaceSurface(entry.surfaceId).title
}

/** 界内夹紧。所有 reducer 出口都过它一次，activeIndex 因此永不越界。 */
function settle(entries: readonly Entry[], activeIndex: number): WorkbenchState {
  if (entries.length === 0) {
    return INITIAL_STATE
  }

  return { entries, activeIndex: Math.min(Math.max(activeIndex, 0), entries.length - 1) }
}

function indexOfId(state: WorkbenchState, tabId: WorkbenchTabId): number {
  return state.entries.findIndex((entry) => entryId(entry) === tabId)
}

function indexOfThread(state: WorkbenchState, threadId: ConversationId): number {
  return state.entries.findIndex(
    (entry) => entry.kind === 'conversation' && entry.threadId === threadId,
  )
}

function insertRightOfActive(state: WorkbenchState, entry: Entry): WorkbenchState {
  const at = state.activeIndex + 1
  const entries = [...state.entries.slice(0, at), entry, ...state.entries.slice(at)]

  return settle(entries, at)
}

/* ── reducer：全部是全函数，无一处 throw ─────────────────────────── */

function openWorkspaceSurface(
  state: WorkbenchState,
  surfaceId: WorkspaceSurfaceId,
): WorkbenchState {
  const existing = indexOfId(state, `workspace:${surfaceId}`)

  return existing >= 0
    ? settle(state.entries, existing)
    : insertRightOfActive(state, { kind: 'workspace', surfaceId })
}

/**
 * 打开一条已有对话。
 *
 * 正在看的那一格本身就是会话形态（对话，或启动时的 ai 表面）时就地替换：
 * 侧栏是导航，不是标签工厂。其余形态插在活动标签右侧。
 */
function openConversation(state: WorkbenchState, request: OpenConversationRequest): WorkbenchState {
  const existing = indexOfThread(state, request.threadId)

  if (existing >= 0) {
    return settle(state.entries, existing)
  }

  const entry: ConversationEntry = {
    kind: 'conversation',
    threadId: request.threadId,
    title: request.title,
  }
  const active = state.entries[state.activeIndex]
  const replaceable =
    active !== undefined &&
    (active.kind === 'conversation' ||
      (active.kind === 'workspace' && active.surfaceId === DEFAULT_SURFACE_ID))

  if (!replaceable) {
    return insertRightOfActive(state, entry)
  }

  return settle(
    state.entries.map((candidate, index) => (index === state.activeIndex ? entry : candidate)),
    state.activeIndex,
  )
}

function openConversationInNewTab(
  state: WorkbenchState,
  request: OpenConversationRequest,
): WorkbenchState {
  const existing = indexOfThread(state, request.threadId)

  return existing >= 0
    ? settle(state.entries, existing)
    : insertRightOfActive(state, {
        kind: 'conversation',
        threadId: request.threadId,
        title: request.title,
      })
}

function setConversationTitle(
  state: WorkbenchState,
  threadId: ConversationId,
  title: string,
): WorkbenchState {
  const index = indexOfThread(state, threadId)
  const entry = state.entries[index]

  /* 同引用返回 = 订阅者不会被唤醒。改名不该让整条标签条重渲染。 */
  if (entry?.kind !== 'conversation' || entry.title === title) {
    return state
  }

  return settle(
    state.entries.map((candidate, candidateIndex) =>
      candidateIndex === index ? { ...entry, title } : candidate,
    ),
    state.activeIndex,
  )
}

/**
 * 拿掉一格并决定接下来看哪一格：右邻居优先，没有就左邻居，一格不剩回到启动态。
 *
 * 「人按了叉」与「这条对话没了」两个入口共用这一段，两处各写一遍必然分叉。
 */
function dropAt(state: WorkbenchState, index: number): WorkbenchState {
  if (index < 0 || index >= state.entries.length) {
    return state
  }

  const entries = state.entries.filter((_entry, candidate) => candidate !== index)
  const nextActive = index < state.activeIndex ? state.activeIndex - 1 : state.activeIndex

  return settle(entries, nextActive)
}

function moveTab(
  state: WorkbenchState,
  tabId: WorkbenchTabId,
  targetIndex: number,
): WorkbenchState {
  const from = indexOfId(state, tabId)
  const source = state.entries[from]

  if (from < 0 || source === undefined) {
    return state
  }

  const to = Math.min(Math.max(targetIndex, 0), state.entries.length - 1)

  if (from === to) {
    return state
  }

  /*
   * targetIndex 是这个标签最终应当所在的位置。先移除源元素，数组已经变短，
   * 在短数组的 to 处插入，落点正好是结果里的 to —— 向右拖动不需要额外补偿。
   */
  const entries = [...state.entries]
  entries.splice(from, 1)
  entries.splice(to, 0, source)

  const activeEntry = state.entries[state.activeIndex]

  return settle(entries, activeEntry === undefined ? to : entries.indexOf(activeEntry))
}

/* ── 投影 ─────────────────────────────────────────────────────────── */

function projectTab(entry: Entry, isActive: boolean): WorkbenchTabViewModel {
  const common = { id: entryId(entry), title: entryTitle(entry), canClose: true, isActive }

  return entry.kind === 'conversation'
    ? { ...common, kind: 'conversation', threadId: entry.threadId }
    : { ...common, kind: 'workspace', surfaceId: entry.surfaceId }
}

function projectSurface(entry: Entry): WorkbenchSurfaceViewModel {
  const tabId = entryId(entry)

  if (entry.kind === 'conversation') {
    const surface: ActiveConversationViewModel = {
      kind: 'conversation',
      tabId,
      threadId: entry.threadId,
      title: entry.title,
    }

    return surface
  }

  const surface: WorkspaceSurfaceViewModel = {
    kind: 'workspace',
    tabId,
    surfaceId: entry.surfaceId,
    title: describeWorkspaceSurface(entry.surfaceId).title,
  }

  return surface
}

/**
 * 投影。
 *
 * activeEntry 一定存在：settle 保证 entries 非空且 activeIndex 界内。
 * 因此这里没有 WORKBENCH_ACTIVE_ENTRY_NOT_FOUND 那种运行时抛错 ——
 * 那个 throw 的存在本身就是「activeTabId 与 entries 是两份真相」的证据。
 */
function project(state: WorkbenchState): WorkbenchViewModel {
  const activeEntry = state.entries[state.activeIndex] ?? DEFAULT_ENTRY

  return {
    activeTabId: entryId(activeEntry),
    tabs: state.entries.map((entry, index) => projectTab(entry, index === state.activeIndex)),
    activeSurface: projectSurface(activeEntry),
  }
}

/* ── 持久化编解码 ─────────────────────────────────────────────────── */

function encode(state: WorkbenchState): PersistedWorkbenchState {
  return {
    version: 1,
    activeIndex: state.activeIndex,
    tabs: state.entries.map((entry) =>
      entry.kind === 'conversation'
        ? { kind: 'conversation', threadId: entry.threadId, title: entry.title }
        : { kind: 'workspace', surfaceId: entry.surfaceId },
    ),
  }
}

function decode(persisted: PersistedWorkbenchState): WorkbenchState {
  const entries = persisted.tabs.map<Entry>((tab) =>
    tab.kind === 'conversation'
      ? { kind: 'conversation', threadId: tab.threadId, title: tab.title }
      : { kind: 'workspace', surfaceId: tab.surfaceId },
  )

  return settle(entries, persisted.activeIndex)
}

export interface WorkbenchSessionControllerOptions {
  /** 工作台状态按工作区分域，键见 WorkbenchStatePort。缺省则不落盘。 */
  readonly workspaceKey?: string | undefined
  readonly persistence?: WorkbenchStatePort | undefined
}

export function createWorkbenchSessionController(
  options: WorkbenchSessionControllerOptions = {},
): WorkbenchSessionStore {
  const { workspaceKey, persistence } = options

  let state = INITIAL_STATE
  let snapshot = project(state)
  const listeners = new Set<() => void>()

  function commit(next: WorkbenchState): void {
    /* 同引用即无变化：不重新投影，不唤醒订阅者。 */
    if (next === state) {
      return
    }

    state = next
    snapshot = project(state)

    for (const listener of listeners) {
      listener()
    }

    if (workspaceKey !== undefined && persistence !== undefined) {
      /*
       * 写盘失败只影响下次启动的还原，不该把用户这次的操作打断，
       * 所以在这里终结而不是往上抛；但不吞掉——交给宿主的错误通道。
       */
      void persistence.write(workspaceKey, encode(state)).catch((cause: unknown) => {
        reportPersistFailure(cause)
      })
    }
  }

  /* 启动还原：这个工作区自己的工作台状态，重启后原样回来。 */
  if (workspaceKey !== undefined && persistence !== undefined) {
    void persistence
      .read(workspaceKey)
      .then((persisted) => {
        if (persisted !== null) {
          commit(decode(persisted))
        }
      })
      .catch(reportPersistFailure)
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },

    openWorkspaceSurface: (request: OpenWorkspaceSurfaceRequest) => {
      commit(openWorkspaceSurface(state, request.surfaceId))
    },
    openConversation: (request) => {
      commit(openConversation(state, request))
    },
    openConversationInNewTab: (request) => {
      commit(openConversationInNewTab(state, request))
    },
    setConversationTitle: (threadId, title) => {
      commit(setConversationTitle(state, threadId, title))
    },
    activateTab: (tabId) => {
      const index = indexOfId(state, tabId)
      commit(index < 0 ? state : settle(state.entries, index))
    },
    closeTab: (tabId) => {
      commit(dropAt(state, indexOfId(state, tabId)))
    },
    closeConversation: (threadId) => {
      commit(dropAt(state, indexOfThread(state, threadId)))
    },
    moveTab: (tabId, targetIndex) => {
      commit(moveTab(state, tabId, targetIndex))
    },
  }
}

function reportPersistFailure(cause: unknown): void {
  warn('工作台状态持久化失败，下次启动将回到默认布局', { scope: 'workbench', cause })
}

export { CONVERSATION_ENTRY_TITLE }
