import { createTLStore } from '@tldraw/editor'
import {
  defaultBindingUtils,
  defaultShapeUtils,
  type Editor,
  type TLAnyShapeUtilConstructor,
  type TLAssetStore,
  type TLStore,
  type TLStoreSnapshot,
} from 'tldraw'

import {
  buildExtensionRegistration,
  type ExtensionRegistration,
  type PoieticaExtension,
} from '../contracts/public-api'

// Contract tests: tests/unit/document-lifecycle/tlstore-record-id-contract.test.ts

/**
 * Process-local Native resource capability associated with an opened document.
 *
 * This value is an opaque lifecycle capability. It is never part of the .draw
 * format and must never be interpreted as a path, URL or archive entry.
 */
export interface EditorAssetStoreRestore {
  readonly persistenceToken: string
}

export interface EditorAssetStoreSession {
  readonly assets: TLAssetStore

  /**
   * Settles accepted asset operations and returns the Native resource-session
   * capability. Asset-free documents return null without allocating a session.
   */
  readonly getPersistenceToken: () => Promise<string | null>

  readonly dispose: () => Promise<void>
}

export type EditorAssetStoreSessionFactory = (
  restore?: EditorAssetStoreRestore,
) => EditorAssetStoreSession

export interface CreateEditorSessionOptions {
  readonly sessionId: string
  readonly documentId: string
  readonly initialSnapshot?: TLStoreSnapshot

  /**
   * Present only when Native has transactionally restored resources while
   * opening an existing v2 document.
   */
  readonly assetStoreRestore?: EditorAssetStoreRestore

  readonly extensions?: readonly PoieticaExtension[]
}

export type EditorSessionState = 'created' | 'attached' | 'detached' | 'disposed'

/**
 * Stable application-level error for a persisted snapshot that tldraw cannot
 * migrate, validate or load using the complete extension-aware store schema.
 *
 * The original error intentionally remains private: it can contain tldraw
 * implementation details and record content that must not become a UI/API
 * contract.
 */
export class PersistedSnapshotLoadError extends Error {
  readonly code = 'DRAW_INVALID_SNAPSHOT'

  constructor() {
    super('DRAW_INVALID_SNAPSHOT')
    this.name = 'PersistedSnapshotLoadError'
  }
}

export interface EditorDocumentChanges {
  readonly added: Readonly<Record<string, unknown>>
  readonly updated: Readonly<Record<string, readonly [before: unknown, after: unknown]>>
  readonly removed: Readonly<Record<string, unknown>>
}

export type EditorDocumentEvent =
  | {
      readonly kind: 'ready'
    }
  | {
      readonly kind: 'changed'
      readonly changes: EditorDocumentChanges
    }

export interface CanvasPageSnapshot {
  readonly id: string
  readonly title: string
  readonly isActive: boolean
}

export interface EditorSessionSnapshot {
  readonly pages: readonly CanvasPageSnapshot[]
}

export interface EditorSession {
  readonly sessionId: string
  readonly documentId: string
  readonly store: TLStore
  readonly registration: ExtensionRegistration
  readonly editor: Editor | null
  readonly state: EditorSessionState

  readonly attachEditor: (editor: Editor) => void

  readonly detachEditor: (editor: Editor) => void

  /**
   * Explicit document persistence adapter consumed structurally by
   * editor/document's EditorDocumentPort.
   */
  readonly captureDocument: () => TLStoreSnapshot

  /**
   * Returns the settled Native resource capability for the same editor session
   * whose TLStoreSnapshot is being persisted.
   */
  readonly captureAssetPersistenceToken: () => Promise<string | null>

  readonly subscribeDocumentEvents: (listener: (event: EditorDocumentEvent) => void) => () => void

  readonly getSessionSnapshot: () => EditorSessionSnapshot
  readonly subscribe: (listener: () => void) => () => void

  readonly createPage: (title: string) => void

  readonly activatePage: (pageId: string) => void

  readonly dispose: () => void
}

export function createEditorSession(
  options: CreateEditorSessionOptions,
  assetStoreSession: EditorAssetStoreSession,
): EditorSession {
  const registration = buildExtensionRegistration(options.extensions)

  /*
   * Persisted documents enter through tldraw's canonical store-construction
   * pipeline. The factory builds the complete schema from default and extension
   * utilities, then migrates and loads the snapshot before a session exists.
   *
   * Do not reintroduce a post-construction loadSnapshot call here. That creates
   * a second initialization path with subtly different migration and session
   * state semantics.
   */
  const store = createValidatedEditorStore(
    registration,
    options.initialSnapshot,
    assetStoreSession.assets,
  )

  let attachedEditor: Editor | null = null
  let state: EditorSessionState = 'created'
  let documentReady = false

  const sessionListeners = new Set<() => void>()

  const documentListeners = new Set<(event: EditorDocumentEvent) => void>()

  let sessionSnapshot: EditorSessionSnapshot = {
    pages: [],
  }

  function assertActive(): void {
    if (state === 'disposed') {
      throw new Error('EDITOR_SESSION_DISPOSED')
    }
  }

  function requireAttachedEditor(): Editor {
    assertActive()

    if (state !== 'attached' || !attachedEditor) {
      throw new Error('EDITOR_SESSION_NOT_ATTACHED')
    }

    return attachedEditor
  }

  function captureDocument(): TLStoreSnapshot {
    assertActive()

    /*
     * TLStore document records are the sole persistable canvas source of truth.
     * Session state belongs to the local editor instance and is deliberately
     * excluded from this boundary.
     */
    return store.getStoreSnapshot()
  }

  function createSessionSnapshot(): EditorSessionSnapshot {
    if (!attachedEditor) {
      return {
        pages: [],
      }
    }

    const activePageId = attachedEditor.getCurrentPageId()

    return {
      pages: attachedEditor.getPages().map((page) => ({
        id: page.id,
        title: page.name,
        isActive: page.id === activePageId,
      })),
    }
  }

  function publishSessionSnapshot(): void {
    sessionSnapshot = createSessionSnapshot()

    for (const listener of sessionListeners) {
      listener()
    }
  }

  function publishDocumentEvent(event: EditorDocumentEvent): void {
    for (const listener of documentListeners) {
      listener(event)
    }
  }

  /*
   * A shape transaction must not rebuild the page projection.
   *
   * TLStore already provides the precise RecordsDiff, so page navigation state
   * is projected only when a page record actually changes.
   */
  const stopObservingSession = store.listen(
    ({ changes }) => {
      if (hasPageRecordChange(changes)) {
        publishSessionSnapshot()
      }
    },
    {
      scope: 'document',
    },
  )

  /*
   * Persistable change observation is armed only after attachEditor declares
   * the mounted tldraw Editor ready. No timer, microtask or record-type
   * heuristic is used.
   */
  const stopObservingDocument = store.listen(
    ({ changes }) => {
      if (state !== 'attached' || !documentReady) {
        return
      }

      /*
       * Forward the official incremental Store diff. Do not construct a full
       * TLStoreSnapshot on the pointer-driven interaction path.
       */
      publishDocumentEvent({
        kind: 'changed',
        changes,
      })
    },
    {
      /*
       * No source filter.
       *
       * Restricting observation to source 'user' left every other document
       * mutation invisible to dirty tracking, so the incremental view of the
       * document could drift from the store. The document session compensated
       * by rebuilding its entire dirty set from a fresh snapshot at each save
       * boundary, which made the incremental path pure overhead: it was
       * discarded and recomputed anyway.
       *
       * Observing the full document scope makes the dirty ledger authoritative
       * by construction, which is what allows that rebuild to be deleted.
       */
      scope: 'document',
    },
  )

  return {
    sessionId: options.sessionId,
    documentId: options.documentId,
    store,
    registration,

    get editor() {
      return attachedEditor
    },

    get state() {
      return state
    },

    attachEditor(editor) {
      assertActive()

      if (attachedEditor && attachedEditor !== editor) {
        throw new Error('EDITOR_SESSION_ALREADY_ATTACHED')
      }

      attachedEditor = editor
      state = 'attached'

      /*
       * Tldraw invokes onMount only after its canonical Editor and initial
       * document records exist. This attachment is therefore the explicit
       * initialization boundary.
       */
      documentReady = true

      publishSessionSnapshot()
      publishDocumentEvent({
        kind: 'ready',
      })
    },

    detachEditor(editor) {
      if (attachedEditor !== editor) {
        return
      }

      documentReady = false
      attachedEditor = null
      state = 'detached'
      publishSessionSnapshot()
    },

    captureDocument,

    captureAssetPersistenceToken() {
      assertActive()
      return assetStoreSession.getPersistenceToken()
    },

    subscribeDocumentEvents(listener) {
      assertActive()

      documentListeners.add(listener)

      return () => {
        documentListeners.delete(listener)
      }
    },

    getSessionSnapshot() {
      return sessionSnapshot
    },

    subscribe(listener) {
      sessionListeners.add(listener)

      return () => {
        sessionListeners.delete(listener)
      }
    },

    createPage(title) {
      const normalizedTitle = title.trim()

      if (!normalizedTitle) {
        throw new Error('EDITOR_PAGE_TITLE_REQUIRED')
      }

      const editor = requireAttachedEditor()

      editor.createPage({
        name: normalizedTitle,
      })
    },

    activatePage(pageId) {
      const editor = requireAttachedEditor()
      const page = editor.getPages().find((candidate) => candidate.id === pageId)

      if (!page) {
        throw new Error('EDITOR_PAGE_NOT_FOUND')
      }

      editor.setCurrentPage(page)
    },

    dispose() {
      if (state === 'disposed') {
        return
      }

      stopObservingSession()
      stopObservingDocument()

      sessionListeners.clear()
      documentListeners.clear()

      documentReady = false
      attachedEditor = null
      state = 'disposed'
    },
  }
}

function createValidatedEditorStore(
  registration: ExtensionRegistration,
  initialSnapshot: TLStoreSnapshot | undefined,
  assets: TLAssetStore,
): TLStore {
  try {
    return createTLStore({
      assets,
      shapeUtils: [
        ...defaultShapeUtils,
        ...registration.shapeUtils,
      ] as unknown as readonly TLAnyShapeUtilConstructor[],
      bindingUtils: [...defaultBindingUtils, ...registration.bindingUtils],
      ...(initialSnapshot ? { snapshot: initialSnapshot } : {}),
    })
  } catch {
    /*
     * tldraw performs schema migration, record validation and store integrity
     * checks here. A failed load must never expose a partially created store or
     * leak library-specific error text across the application boundary.
     */
    throw new PersistedSnapshotLoadError()
  }
}

interface OwnedEditorSession {
  readonly session: EditorSession
  readonly assetStoreSession: EditorAssetStoreSession
}

export interface EditorSessionRegistry {
  readonly create: (options: CreateEditorSessionOptions) => Promise<EditorSession>

  readonly get: (sessionId: string) => EditorSession | null

  readonly require: (sessionId: string) => EditorSession

  readonly close: (sessionId: string) => Promise<void>

  readonly dispose: () => Promise<void>
}

export function createEditorSessionRegistry(
  assetStoreFactory: EditorAssetStoreSessionFactory,
): EditorSessionRegistry {
  const sessions = new Map<string, OwnedEditorSession>()

  return {
    async create(options) {
      if (sessions.has(options.sessionId)) {
        throw new Error('EDITOR_SESSION_DUPLICATE_ID')
      }

      const assetStoreSession = assetStoreFactory(options.assetStoreRestore)

      let session: EditorSession

      try {
        session = createEditorSession(options, assetStoreSession)
      } catch (creationError) {
        try {
          await assetStoreSession.dispose()
        } catch (cleanupError) {
          throw new AggregateError(
            [creationError, cleanupError],
            'EDITOR_SESSION_CREATION_ROLLBACK_FAILED',
          )
        }

        throw creationError
      }

      sessions.set(options.sessionId, {
        session,
        assetStoreSession,
      })

      return session
    },

    get(sessionId) {
      return sessions.get(sessionId)?.session ?? null
    },

    require(sessionId) {
      const owned = sessions.get(sessionId)

      if (!owned) {
        throw new Error('EDITOR_SESSION_NOT_FOUND')
      }

      return owned.session
    },

    async close(sessionId) {
      const owned = sessions.get(sessionId)

      if (!owned) {
        return
      }

      /*
       * Remove ownership before asynchronous disposal so callers cannot acquire
       * a session that has already entered its closing lifecycle.
       */
      sessions.delete(sessionId)
      owned.session.dispose()

      await owned.assetStoreSession.dispose()
    },

    async dispose() {
      const ownedSessions = [...sessions.values()]

      sessions.clear()

      for (const owned of ownedSessions) {
        owned.session.dispose()
      }

      await Promise.all(ownedSessions.map((owned) => owned.assetStoreSession.dispose()))
    },
  }
}

interface StoreRecordChanges {
  readonly added: Readonly<Record<string, unknown>>
  readonly updated: Readonly<Record<string, readonly [before: unknown, after: unknown]>>
  readonly removed: Readonly<Record<string, unknown>>
}

/*
 * TLStore record identifiers are type-prefixed, so page participation in a
 * diff is decided from the diff keys alone.
 *
 * The previous implementation called Object.values on all three diff
 * containers and inspected `typeName` on each materialised record. That
 * allocated three arrays per store transaction on the pointer-driven path in
 * order to answer a question the keys already answer.
 */
const PAGE_RECORD_ID_PREFIX = 'page:'

function hasPageRecordChange(changes: StoreRecordChanges): boolean {
  return (
    containsPageRecordId(changes.added) ||
    containsPageRecordId(changes.updated) ||
    containsPageRecordId(changes.removed)
  )
}

function containsPageRecordId(container: Readonly<Record<string, unknown>>): boolean {
  for (const id in container) {
    if (Object.hasOwn(container, id) && id.startsWith(PAGE_RECORD_ID_PREFIX)) {
      return true
    }
  }

  return false
}
