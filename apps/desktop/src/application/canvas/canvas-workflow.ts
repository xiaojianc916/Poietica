import type { EditorSession } from '@hybrid-canvas/canvas/application'
import type {
  CanvasCloseIntent,
  CanvasCloseSnapshot,
  CanvasCloseState,
  CanvasDocumentService,
  CanvasReleaseResult,
  CanvasSessionId,
  CanvasSessionSnapshot,
} from '@hybrid-canvas/document'
import type { WorkbenchSessionStore } from '@hybrid-canvas/workspace/contracts'

/**
 * Application termination has exactly one asynchronous boundary:
 * every active save and every active native document release settles first.
 */
export type ApplicationClosePlan =
  | { readonly kind: 'close-now' }
  | {
      readonly kind: 'confirm-discard'
      readonly sessionIds: readonly CanvasSessionId[]
    }
  | {
      readonly kind: 'wait-for-settlement'
      readonly operations: readonly Promise<void>[]
    }

const EMPTY_CLOSE_SNAPSHOT: CanvasCloseSnapshot = Object.freeze({
  states: Object.freeze({}),
})

export interface CanvasWorkflow {
  readonly create: (title: string) => Promise<void>
  readonly open: () => Promise<void>
  readonly save: (sessionId: CanvasSessionId) => Promise<void>
  readonly closeCanvas: (sessionId: CanvasSessionId, intent: CanvasCloseIntent) => Promise<void>
  readonly cancelCanvasClose: (sessionId: CanvasSessionId) => void
  readonly getCloseSnapshot: () => CanvasCloseSnapshot
  readonly planApplicationClose: () => ApplicationClosePlan
  readonly getEditorSession: (sessionId: CanvasSessionId) => EditorSession | null
  readonly getSessionSnapshot: (sessionId: CanvasSessionId) => CanvasSessionSnapshot | null
  readonly getVersion: () => number
  readonly subscribe: (listener: () => void) => () => void
  readonly dispose: () => Promise<void>
}

export function createCanvasWorkflow(
  documents: CanvasDocumentService,
  workspace: WorkbenchSessionStore,
): CanvasWorkflow {
  const listeners = new Set<() => void>()
  const closeOperations = new Map<CanvasSessionId, Promise<void>>()
  const closeStates = new Map<CanvasSessionId, CanvasCloseState>()

  let version = 0
  let closeSnapshot = EMPTY_CLOSE_SNAPSHOT

  const stopDocumentSubscription = documents.subscribe(emit)

  function emit(): void {
    version += 1

    for (const listener of listeners) {
      listener()
    }
  }

  function publishCloseStates(): void {
    closeSnapshot =
      closeStates.size === 0
        ? EMPTY_CLOSE_SNAPSHOT
        : {
            states: Object.freeze(
              Object.fromEntries(closeStates) as Record<CanvasSessionId, CanvasCloseState>,
            ),
          }

    emit()
  }

  function setCloseState(sessionId: CanvasSessionId, state: CanvasCloseState): void {
    closeStates.set(sessionId, state)
    publishCloseStates()
  }

  function clearCloseState(sessionId: CanvasSessionId): void {
    if (closeStates.delete(sessionId)) {
      publishCloseStates()
    }
  }

  async function create(title: string): Promise<void> {
    const opened = await documents.create(title)

    try {
      workspace.createCanvas(opened)
    } catch (workspaceError) {
      await rollbackOpenedCanvas(opened.sessionId, 'CANVAS_CREATION_ROLLBACK_FAILED')
      throw workspaceError
    }
  }

  async function open(): Promise<void> {
    const opened = await documents.open()

    if (!opened) {
      return
    }

    try {
      workspace.createCanvas(opened)
    } catch (workspaceError) {
      await rollbackOpenedCanvas(opened.sessionId, 'CANVAS_OPEN_ROLLBACK_FAILED')
      throw workspaceError
    }
  }

  async function rollbackOpenedCanvas(
    sessionId: CanvasSessionId,
    errorCode: string,
  ): Promise<void> {
    const result = await documents.releaseCanvas(sessionId, 'discard')

    if (result.kind !== 'released' && result.kind !== 'not-found') {
      throw new Error(errorCode)
    }
  }

  function closeCanvas(sessionId: CanvasSessionId, intent: CanvasCloseIntent): Promise<void> {
    const existingOperation = closeOperations.get(sessionId)

    if (existingOperation) {
      return existingOperation
    }

    const operation = runCloseTransaction(sessionId, intent).finally(() => {
      closeOperations.delete(sessionId)
      emit()
    })

    closeOperations.set(sessionId, operation)

    return operation
  }

  async function runCloseTransaction(
    sessionId: CanvasSessionId,
    intent: CanvasCloseIntent,
  ): Promise<void> {
    setCloseState(sessionId, {
      state: 'releasing',
      intent,
    })

    const result = await documents.releaseCanvas(sessionId, intent)

    applyReleaseResult(sessionId, intent, result)
  }

  function applyReleaseResult(
    sessionId: CanvasSessionId,
    intent: CanvasCloseIntent,
    result: CanvasReleaseResult,
  ): void {
    switch (result.kind) {
      case 'released':
        workspace.closeCanvas(sessionId)
        clearCloseState(sessionId)
        return

      case 'confirmation-required':
        setCloseState(sessionId, {
          state: 'confirmation-required',
        })
        return

      case 'release-failed':
        setCloseState(sessionId, {
          state: 'release-failed',
          intent,
          failure: result.failure,
        })
        return

      case 'not-found':
        clearCloseState(sessionId)
        return
    }
  }

  function planApplicationClose(): ApplicationClosePlan {
    const documentLifecycle = documents.getLifecycleSnapshot()

    const operations = [...documentLifecycle.savingOperations, ...closeOperations.values()]

    if (operations.length > 0) {
      return {
        kind: 'wait-for-settlement',
        operations,
      }
    }

    if (documentLifecycle.unsavedSessionIds.length > 0) {
      return {
        kind: 'confirm-discard',
        sessionIds: documentLifecycle.unsavedSessionIds,
      }
    }

    return { kind: 'close-now' }
  }

  return {
    create,
    open,
    save: documents.save,
    closeCanvas,

    cancelCanvasClose(sessionId) {
      const state = closeStates.get(sessionId)

      if (!state || state.state === 'releasing') {
        return
      }

      clearCloseState(sessionId)
    },

    getCloseSnapshot() {
      return closeSnapshot
    },

    planApplicationClose,
    getEditorSession: documents.getEditorSession,
    getSessionSnapshot: documents.getSessionSnapshot,

    getVersion() {
      return version
    },

    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },

    async dispose() {
      stopDocumentSubscription()
      closeOperations.clear()
      closeStates.clear()
      closeSnapshot = EMPTY_CLOSE_SNAPSHOT
      listeners.clear()

      await documents.dispose()
    },
  }
}
