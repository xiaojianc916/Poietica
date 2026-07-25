import type { TLStoreSnapshot } from 'tldraw'

import {
  applyDocumentChanges,
  cloneDocumentCheckpoint,
  createDocumentCheckpoint,
  type DocumentCheckpoint,
  type DocumentRecordChanges,
  rebuildDirtyRecords,
  reconcileDirtyRecords,
} from './document-checkpoint'

export type DocumentSessionPhase =
  | 'initializing'
  | 'ready'
  | 'saving'
  | 'save-failed'
  | 'closing'
  | 'closed'

export type DocumentPersistenceState = 'clean' | 'dirty' | 'saving' | 'failed'

type ReopenableDocumentSessionPhase = Exclude<DocumentSessionPhase, 'closing' | 'closed'>

export interface DocumentSaveTicket {
  readonly id: number
  readonly checkpoint: DocumentCheckpoint
}

export interface DocumentSessionSnapshot {
  readonly phase: DocumentSessionPhase
  readonly persistence: DocumentPersistenceState
  readonly documentId: string | null
}

export interface DocumentSession {
  readonly initialize: (snapshot: TLStoreSnapshot) => void

  /**
   * Applies a tldraw Store diff to dirty tracking.
   *
   * This path must remain incremental. Full snapshots are reserved for
   * initialization and explicit persistence boundaries.
   */
  readonly recordDocumentChange: (changes: DocumentRecordChanges) => void

  readonly beginSave: (snapshot: TLStoreSnapshot) => DocumentSaveTicket

  readonly completeSave: (ticket: DocumentSaveTicket, documentId: string) => void

  readonly failSave: (ticket: DocumentSaveTicket) => void
  readonly beginClosing: () => void
  readonly cancelClosing: () => void
  readonly completeClosing: () => void
  readonly isInitialized: () => boolean
  readonly isDirty: () => boolean
  readonly getPhase: () => DocumentSessionPhase
  readonly getDocumentId: () => string | null
  readonly getSnapshot: () => DocumentSessionSnapshot
}

export function createDocumentSession(initialDocumentId: string | null): DocumentSession {
  let phase: DocumentSessionPhase = 'initializing'
  let currentCheckpoint: DocumentCheckpoint | null = null
  let savedCheckpoint: DocumentCheckpoint | null = null
  let documentId = initialDocumentId
  let activeSave: DocumentSaveTicket | null = null
  let phaseBeforeClosing: ReopenableDocumentSessionPhase | null = null
  let nextSaveId = 1

  const dirtyRecordIds = new Set<string>()

  /*
   * Record ids reported between beginSave and completeSave.
   *
   * completeSave previously called rebuildDirtyRecords, a full structural
   * comparison of every record in the document against the checkpoint Native
   * had just accepted. That ran on every successful save even though the
   * result is already determined: beginSave sets currentCheckpoint to a copy
   * of the ticket checkpoint, so the two are structurally identical at that
   * instant, and completeSave then promotes the ticket checkpoint to saved.
   * The only records that can still differ are the ones that changed while
   * the save was in flight.
   *
   * Tracking those ids makes reconciliation O(k) in the number of concurrent
   * edits, and O(1) in the overwhelmingly common case where there were none,
   * instead of O(N) in document size on the user-visible save path.
   */
  const changedDuringSave = new Set<string>()

  function assertNotClosed(): void {
    if (phase === 'closing' || phase === 'closed') {
      throw new Error('DOCUMENT_SESSION_NOT_ACTIVE')
    }
  }

  function requireInitialized(): {
    readonly current: DocumentCheckpoint
    readonly saved: DocumentCheckpoint
  } {
    if (!currentCheckpoint || !savedCheckpoint) {
      throw new Error('DOCUMENT_SESSION_NOT_INITIALIZED')
    }

    return {
      current: currentCheckpoint,
      saved: savedCheckpoint,
    }
  }

  function requireActiveTicket(ticket: DocumentSaveTicket): void {
    if (!activeSave || activeSave.id !== ticket.id) {
      throw new Error('DOCUMENT_SESSION_STALE_SAVE_TICKET')
    }
  }

  function isDirty(): boolean {
    return dirtyRecordIds.size > 0
  }

  function persistence(): DocumentPersistenceState {
    if (phase === 'saving') {
      return 'saving'
    }

    if (phase === 'save-failed') {
      return 'failed'
    }

    return isDirty() ? 'dirty' : 'clean'
  }

  return {
    initialize(snapshot) {
      assertNotClosed()

      if (phase !== 'initializing') {
        throw new Error('DOCUMENT_SESSION_ALREADY_INITIALIZED')
      }

      const checkpoint = createDocumentCheckpoint(snapshot)

      savedCheckpoint = checkpoint
      currentCheckpoint = cloneDocumentCheckpoint(checkpoint)
      dirtyRecordIds.clear()
      changedDuringSave.clear()
      phase = 'ready'
    },

    recordDocumentChange(changes) {
      assertNotClosed()

      const { current, saved } = requireInitialized()
      const changedIds = applyDocumentChanges(current, changes)

      reconcileDirtyRecords(current, saved, dirtyRecordIds, changedIds)

      if (phase === 'saving') {
        for (const id of changedIds) {
          changedDuringSave.add(id)
        }
      }

      if (phase === 'save-failed') {
        phase = 'ready'
      }
    },

    beginSave(snapshot) {
      assertNotClosed()
      requireInitialized()

      if (phase === 'saving') {
        throw new Error('DOCUMENT_SESSION_SAVE_ALREADY_ACTIVE')
      }

      /*
       * Explicit save is a valid full-snapshot boundary.
       *
       * The save ticket owns an immutable checkpoint. The mutable current
       * checkpoint is cloned so edits arriving while Native persistence is in
       * progress cannot mutate the ticket.
       */
      const checkpoint = createDocumentCheckpoint(snapshot)

      currentCheckpoint = cloneDocumentCheckpoint(checkpoint)

      if (savedCheckpoint) {
        rebuildDirtyRecords(currentCheckpoint, savedCheckpoint, dirtyRecordIds)
      }

      const ticket: DocumentSaveTicket = {
        id: nextSaveId,
        checkpoint,
      }

      nextSaveId += 1
      activeSave = ticket
      changedDuringSave.clear()
      phase = 'saving'

      return ticket
    },

    completeSave(ticket, nextDocumentId) {
      assertNotClosed()
      requireActiveTicket(ticket)

      savedCheckpoint = ticket.checkpoint
      documentId = nextDocumentId
      activeSave = null
      phase = 'ready'

      /*
       * Edits may have arrived while persistence was running.
       *
       * beginSave set currentCheckpoint to a copy of the ticket checkpoint, so
       * the two were structurally identical at that point, and Native has now
       * accepted that ticket checkpoint as saved. The only records that can
       * still be dirty are therefore exactly those reported while the save was
       * in flight. When none arrived, the document is clean by construction
       * and no comparison is needed at all.
       */
      if (changedDuringSave.size === 0) {
        dirtyRecordIds.clear()
      } else if (currentCheckpoint) {
        reconcileDirtyRecords(currentCheckpoint, savedCheckpoint, dirtyRecordIds, changedDuringSave)
      }

      changedDuringSave.clear()
    },

    failSave(ticket) {
      assertNotClosed()
      requireActiveTicket(ticket)

      activeSave = null
      changedDuringSave.clear()
      phase = 'save-failed'
    },

    beginClosing() {
      switch (phase) {
        case 'initializing':
        case 'ready':
        case 'save-failed':
          phaseBeforeClosing = phase
          phase = 'closing'
          return

        case 'saving':
          throw new Error('DOCUMENT_SESSION_SAVE_IN_PROGRESS')

        case 'closing':
        case 'closed':
          throw new Error('DOCUMENT_SESSION_NOT_ACTIVE')
      }
    },

    cancelClosing() {
      if (phase !== 'closing' || !phaseBeforeClosing) {
        throw new Error('DOCUMENT_SESSION_NOT_CLOSING')
      }

      phase = phaseBeforeClosing
      phaseBeforeClosing = null
    },

    completeClosing() {
      if (phase !== 'closing') {
        throw new Error('DOCUMENT_SESSION_NOT_CLOSING')
      }

      phaseBeforeClosing = null
      phase = 'closed'
    },

    isInitialized() {
      return currentCheckpoint !== null && savedCheckpoint !== null
    },

    isDirty,

    getPhase() {
      return phase
    },

    getDocumentId() {
      return documentId
    },

    getSnapshot() {
      return {
        phase,
        persistence: persistence(),
        documentId,
      }
    },
  }
}
