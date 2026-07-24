import type { TLStoreSnapshot } from 'tldraw'

import {
  checkpointsEqual,
  createDocumentCheckpoint,
  type DocumentCheckpoint,
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
  readonly recordDocumentChange: (snapshot: TLStoreSnapshot) => void
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

  function assertNotClosed() {
    if (phase === 'closing' || phase === 'closed') {
      throw new Error('DOCUMENT_SESSION_NOT_ACTIVE')
    }
  }

  function requireInitialized() {
    if (!currentCheckpoint || !savedCheckpoint) {
      throw new Error('DOCUMENT_SESSION_NOT_INITIALIZED')
    }
  }

  function requireActiveTicket(ticket: DocumentSaveTicket) {
    if (!activeSave || activeSave.id !== ticket.id) {
      throw new Error('DOCUMENT_SESSION_STALE_SAVE_TICKET')
    }
  }

  function isDirty() {
    return (
      currentCheckpoint !== null &&
      savedCheckpoint !== null &&
      !checkpointsEqual(currentCheckpoint, savedCheckpoint)
    )
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
      currentCheckpoint = checkpoint
      savedCheckpoint = checkpoint
      phase = 'ready'
    },

    recordDocumentChange(snapshot) {
      assertNotClosed()
      requireInitialized()

      currentCheckpoint = createDocumentCheckpoint(snapshot)

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

      currentCheckpoint = createDocumentCheckpoint(snapshot)

      const ticket: DocumentSaveTicket = {
        id: nextSaveId,
        checkpoint: currentCheckpoint,
      }

      nextSaveId += 1
      activeSave = ticket
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
    },

    failSave(ticket) {
      assertNotClosed()
      requireActiveTicket(ticket)

      activeSave = null
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
