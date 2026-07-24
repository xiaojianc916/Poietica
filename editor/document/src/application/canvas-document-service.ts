import type { EditorSession, EditorSessionRegistry } from '@hybrid-canvas/canvas/application'
import type { HybridCanvasExtension } from '@hybrid-canvas/canvas/extensions'
import type { TLStoreSnapshot } from 'tldraw'

import {
  createDocumentSession,
  type DocumentPersistenceState,
  type DocumentSession,
} from '../domain/document-session'
import type { EditorDocumentPort } from '../ports/editor-document-port'

export type CanvasId = string
export type CanvasSessionId = string
export type CanvasPersistenceState = DocumentPersistenceState

export interface OpenedCanvasSession {
  readonly canvasId: CanvasId
  readonly sessionId: CanvasSessionId
  readonly title: string
}

export interface CanvasSessionSnapshot {
  readonly sessionId: CanvasSessionId
  readonly persistence: CanvasPersistenceState
}

export type CanvasCloseIntent = 'normal' | 'discard'

export type CanvasReleaseFailureCode =
  | 'permission-denied'
  | 'persistence'
  | 'not-found'
  | 'platform'

export interface CanvasReleaseFailure {
  readonly code: CanvasReleaseFailureCode
  readonly recoverable: boolean
}

export type CanvasCloseState =
  | {
      readonly state: 'confirmation-required'
    }
  | {
      readonly state: 'releasing'
      readonly intent: CanvasCloseIntent
    }
  | {
      readonly state: 'release-failed'
      readonly intent: CanvasCloseIntent
      readonly failure: CanvasReleaseFailure
    }

export interface CanvasCloseSnapshot {
  readonly states: Readonly<Record<CanvasSessionId, CanvasCloseState>>
}

export type CanvasReleaseResult =
  | { readonly kind: 'released' }
  | { readonly kind: 'confirmation-required' }
  | {
      readonly kind: 'release-failed'
      readonly failure: CanvasReleaseFailure
    }
  | { readonly kind: 'not-found' }

export interface CanvasDocumentLifecycleSnapshot {
  readonly savingOperations: readonly Promise<void>[]
  readonly unsavedSessionIds: readonly CanvasSessionId[]
}

export interface CanvasDocumentService {
  readonly create: (title: string) => Promise<OpenedCanvasSession>
  readonly open: () => Promise<OpenedCanvasSession | null>
  readonly save: (sessionId: CanvasSessionId) => Promise<void>
  readonly releaseCanvas: (
    sessionId: CanvasSessionId,
    intent: CanvasCloseIntent,
  ) => Promise<CanvasReleaseResult>
  readonly getLifecycleSnapshot: () => CanvasDocumentLifecycleSnapshot
  readonly getEditorSession: (sessionId: CanvasSessionId) => EditorSession | null
  readonly getSessionSnapshot: (sessionId: CanvasSessionId) => CanvasSessionSnapshot | null
  readonly getVersion: () => number
  readonly subscribe: (listener: () => void) => () => void
  readonly dispose: () => Promise<void>
}

export interface CanvasEditorSessionRegistryPort {
  readonly create: EditorSessionRegistry['create']
  readonly close: EditorSessionRegistry['close']
  readonly dispose: EditorSessionRegistry['dispose']
}

export interface OpenedNativeDocument {
  readonly id: string
  readonly displayName: string
  readonly content: string
  readonly revision: string
  readonly assetPersistenceToken: string | null
}

export interface SavedNativeDocument {
  readonly id: string
  readonly displayName: string
  readonly revision: string
}

export interface DocumentPersistencePort {
  readonly open: () => Promise<OpenedNativeDocument | null>
  readonly save: (
    documentId: string,
    expectedRevision: string,
    content: string,
    assetPersistenceToken: string | null,
  ) => Promise<{ readonly revision: string }>
  readonly saveAs: (
    content: string,
    assetPersistenceToken: string | null,
    options: {
      readonly documentId?: string
      readonly suggestedName?: string
    },
  ) => Promise<SavedNativeDocument | null>
  readonly close: (documentId: string) => Promise<void>
}

export interface CreateCanvasDocumentServiceDependencies {
  readonly editorSessions: CanvasEditorSessionRegistryPort
  readonly persistence: DocumentPersistencePort
  readonly extensions: readonly HybridCanvasExtension[]
}

interface OwnedCanvasSession {
  readonly editor: EditorSession
  readonly editorDocument: EditorDocumentPort
  readonly document: DocumentSession
  stopObservingDocument: () => void
  saveOperation: Promise<void> | null
  revision: string | null
}

export function createCanvasDocumentService({
  editorSessions,
  persistence,
  extensions,
}: CreateCanvasDocumentServiceDependencies): CanvasDocumentService {
  const sessions = new Map<CanvasSessionId, OwnedCanvasSession>()
  const listeners = new Set<() => void>()
  let version = 0

  function emit() {
    version += 1

    for (const listener of listeners) {
      listener()
    }
  }

  async function create(title: string): Promise<OpenedCanvasSession> {
    const canvasId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()

    const editor = await editorSessions.create({
      documentId: canvasId,
      sessionId,
      extensions,
    })

    sessions.set(sessionId, createOwnedSession(editor, null, null))

    return { canvasId, sessionId, title }
  }

  async function open(): Promise<OpenedCanvasSession | null> {
    const opened = await persistence.open()

    if (!opened) {
      return null
    }

    try {
      const canvasId = crypto.randomUUID()
      const sessionId = crypto.randomUUID()
      const initialSnapshot = parseEditorSnapshot(opened.content)

      const editor = await editorSessions.create({
        documentId: canvasId,
        sessionId,
        initialSnapshot,
        ...(opened.assetPersistenceToken
          ? {
              assetStoreRestore: {
                persistenceToken: opened.assetPersistenceToken,
              },
            }
          : {}),
        extensions,
      })

      sessions.set(sessionId, createOwnedSession(editor, opened.id, opened.revision))

      return {
        canvasId,
        sessionId,
        title: opened.displayName,
      }
    } catch (openError) {
      return rollbackOpenedNativeDocument(opened.id, openError)
    }
  }

  async function rollbackOpenedNativeDocument(
    documentId: string,
    openError: unknown,
  ): Promise<never> {
    try {
      await persistence.close(documentId)
    } catch (rollbackError) {
      throw new AggregateError([openError, rollbackError], 'DOCUMENT_OPEN_ROLLBACK_FAILED')
    }

    throw openError
  }

  function createOwnedSession(
    editor: EditorSession,
    documentId: string | null,
    revision: string | null,
  ): OwnedCanvasSession {
    const editorDocument: EditorDocumentPort = editor
    const document = createDocumentSession(documentId)

    const owned: OwnedCanvasSession = {
      editor,
      editorDocument,
      document,
      stopObservingDocument: () => {},
      saveOperation: null,
      revision,
    }

    owned.stopObservingDocument = editorDocument.subscribeDocumentEvents((event) => {
      if (event.kind === 'ready') {
        if (!document.isInitialized()) {
          document.initialize(editorDocument.captureDocument())
          emit()
        }

        return
      }

      if (!document.isInitialized()) {
        throw new Error('DOCUMENT_CHANGE_BEFORE_EDITOR_READY')
      }

      /*
       * Dirty tracking consumes tldraw's incremental RecordsDiff. Full
       * snapshots are reserved for initialization and explicit save.
       */
      document.recordDocumentChange(event.changes)
      emit()
    })

    return owned
  }

  function save(sessionId: CanvasSessionId): Promise<void> {
    const owned = requireSession(sessionId)

    if (owned.saveOperation) {
      return owned.saveOperation
    }

    owned.saveOperation = performSave(owned).finally(() => {
      owned.saveOperation = null
    })

    return owned.saveOperation
  }

  async function performSave(owned: OwnedCanvasSession): Promise<void> {
    if (!owned.document.isInitialized()) {
      throw new Error('DOCUMENT_SESSION_NOT_READY')
    }

    const documentSnapshot = owned.editorDocument.captureDocument()
    const ticket = owned.document.beginSave(documentSnapshot)

    emit()

    try {
      const content = JSON.stringify(documentSnapshot)
      const assetPersistenceToken = await owned.editor.captureAssetPersistenceToken()
      const currentDocumentId = owned.document.getDocumentId()

      const saved = currentDocumentId
        ? await saveExistingDocument(
            currentDocumentId,
            requireRevision(owned),
            content,
            assetPersistenceToken,
          )
        : await persistence.saveAs(content, assetPersistenceToken, {
            suggestedName: '未命名画布.draw',
          })

      if (!saved) {
        owned.document.failSave(ticket)
        emit()
        return
      }

      owned.revision = saved.revision
      owned.document.completeSave(ticket, saved.id)
      emit()
    } catch (error) {
      owned.document.failSave(ticket)
      emit()
      throw error
    }
  }

  function requireRevision(owned: OwnedCanvasSession): string {
    if (!owned.revision) {
      throw new Error('DOCUMENT_REVISION_MISSING')
    }

    return owned.revision
  }

  async function saveExistingDocument(
    documentId: string,
    expectedRevision: string,
    content: string,
    assetPersistenceToken: string | null,
  ): Promise<SavedNativeDocument> {
    const saved = await persistence.save(
      documentId,
      expectedRevision,
      content,
      assetPersistenceToken,
    )

    return {
      id: documentId,
      displayName: '',
      revision: saved.revision,
    }
  }

  async function releaseCanvas(
    sessionId: CanvasSessionId,
    intent: CanvasCloseIntent,
  ): Promise<CanvasReleaseResult> {
    const owned = sessions.get(sessionId)

    if (!owned) {
      return { kind: 'not-found' }
    }

    while (owned.saveOperation) {
      await owned.saveOperation.catch(() => undefined)
    }

    const persistenceState = owned.document.getSnapshot().persistence

    if (intent === 'normal' && (persistenceState === 'dirty' || persistenceState === 'failed')) {
      return { kind: 'confirmation-required' }
    }

    owned.document.beginClosing()
    emit()

    const documentId = owned.document.getDocumentId()

    try {
      if (documentId) {
        await persistence.close(documentId)
      }
    } catch (error) {
      owned.document.cancelClosing()
      emit()

      return {
        kind: 'release-failed',
        failure: toCanvasReleaseFailure(error),
      }
    }

    owned.document.completeClosing()
    owned.stopObservingDocument()
    sessions.delete(sessionId)
    await editorSessions.close(sessionId)
    emit()

    return { kind: 'released' }
  }

  function toCanvasReleaseFailure(error: unknown): CanvasReleaseFailure {
    if (
      typeof error === 'object' &&
      error !== null &&
      'details' in error &&
      typeof error.details === 'object' &&
      error.details !== null
    ) {
      const details = error.details as Record<string, unknown>
      const code = details['code']
      const recoverable = details['recoverable']

      if (
        (code === 'permission-denied' ||
          code === 'persistence' ||
          code === 'not-found' ||
          code === 'platform') &&
        typeof recoverable === 'boolean'
      ) {
        return {
          code,
          recoverable,
        }
      }
    }

    return {
      code: 'platform',
      recoverable: false,
    }
  }

  function getLifecycleSnapshot(): CanvasDocumentLifecycleSnapshot {
    const savingOperations: Promise<void>[] = []
    const unsavedSessionIds: CanvasSessionId[] = []

    for (const [sessionId, owned] of sessions) {
      if (owned.saveOperation) {
        savingOperations.push(owned.saveOperation)
        continue
      }

      const persistence = owned.document.getSnapshot().persistence

      if (persistence === 'dirty' || persistence === 'failed') {
        unsavedSessionIds.push(sessionId)
      }
    }

    return {
      savingOperations,
      unsavedSessionIds,
    }
  }

  function requireSession(sessionId: CanvasSessionId) {
    const owned = sessions.get(sessionId)

    if (!owned) {
      throw new Error('CANVAS_SESSION_NOT_FOUND')
    }

    return owned
  }

  return {
    create,
    open,
    save,
    releaseCanvas,
    getLifecycleSnapshot,

    getEditorSession(sessionId) {
      return sessions.get(sessionId)?.editor ?? null
    },

    getSessionSnapshot(sessionId) {
      const owned = sessions.get(sessionId)

      return owned
        ? {
            sessionId,
            persistence: owned.document.getSnapshot().persistence,
          }
        : null
    },

    getVersion() {
      return version
    },

    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },

    async dispose() {
      for (const owned of sessions.values()) {
        owned.stopObservingDocument()
      }

      sessions.clear()
      listeners.clear()

      await editorSessions.dispose()
    },
  }
}

function parseEditorSnapshot(json: string): TLStoreSnapshot {
  const parsed: unknown = JSON.parse(json)

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !('schema' in parsed) ||
    !('store' in parsed)
  ) {
    throw new Error('DRAW_INVALID_STORE_SNAPSHOT')
  }

  return parsed as TLStoreSnapshot
}
