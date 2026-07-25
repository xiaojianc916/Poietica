import {
  createDocumentDirtyLedger,
  type DocumentDirtyLedger,
  type DocumentRecordChanges,
} from './document-dirty-ledger'

export type DocumentSessionPhase =
  | 'initializing'
  | 'ready'
  | 'saving'
  | 'save-failed'
  | 'closing'
  | 'closed'

export type DocumentPersistenceState = 'clean' | 'dirty' | 'saving' | 'failed'

type ReopenableDocumentSessionPhase = Exclude<DocumentSessionPhase, 'closing' | 'closed'>

/**
 * Identifies one in-flight save.
 *
 * The ticket previously carried a full copy of the document so that
 * completeSave could compare against exactly what persistence had accepted.
 * The dirty ledger records that save point itself, so the ticket is reduced to
 * the identity needed to reject a stale completion.
 */
export interface DocumentSaveTicket {
  readonly id: number
}

export interface DocumentSessionSnapshot {
  readonly phase: DocumentSessionPhase
  readonly persistence: DocumentPersistenceState
  readonly documentId: string | null
}

export interface DocumentSession {
  /**
   * Declares the document open and clean.
   *
   * No snapshot is required. A freshly opened document has nothing to compare
   * against itself, so the previous full-document capture here was pure cost
   * on the open path.
   */
  readonly initialize: () => void

  /**
   * Folds a tldraw Store diff into dirty tracking.
   *
   * This path is incremental by construction. Full snapshots exist only to be
   * serialised for persistence, never to answer dirty state.
   */
  readonly recordDocumentChange: (changes: DocumentRecordChanges) => void

  readonly beginSave: () => DocumentSaveTicket

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
  let initialized = false
  let documentId = initialDocumentId
  let activeSave: DocumentSaveTicket | null = null
  let phaseBeforeClosing: ReopenableDocumentSessionPhase | null = null
  let nextSaveId = 1

  const ledger: DocumentDirtyLedger = createDocumentDirtyLedger()

  function assertNotClosed(): void {
    if (phase === 'closing' || phase === 'closed') {
      throw new Error('DOCUMENT_SESSION_NOT_ACTIVE')
    }
  }

  function requireInitialized(): void {
    if (!initialized) {
      throw new Error('DOCUMENT_SESSION_NOT_INITIALIZED')
    }
  }

  function requireActiveTicket(ticket: DocumentSaveTicket): void {
    if (!activeSave || activeSave.id !== ticket.id) {
      throw new Error('DOCUMENT_SESSION_STALE_SAVE_TICKET')
    }
  }

  function isDirty(): boolean {
    return ledger.isDirty()
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
    initialize() {
      assertNotClosed()

      if (phase !== 'initializing') {
        throw new Error('DOCUMENT_SESSION_ALREADY_INITIALIZED')
      }

      ledger.reset()
      initialized = true
      phase = 'ready'
    },

    recordDocumentChange(changes) {
      assertNotClosed()
      requireInitialized()

      ledger.apply(changes)

      if (phase === 'save-failed') {
        phase = 'ready'
      }
    },

    beginSave() {
      assertNotClosed()
      requireInitialized()

      if (phase === 'saving') {
        throw new Error('DOCUMENT_SESSION_SAVE_ALREADY_ACTIVE')
      }

      /*
       * The caller serialises the document as it stands right now, so right
       * now is the pending save point. Opening the window is O(1); the
       * previous implementation captured a snapshot, built two full record
       * Maps from it and structurally compared the whole document.
       */
      ledger.openSaveWindow()

      const ticket: DocumentSaveTicket = { id: nextSaveId }

      nextSaveId += 1
      activeSave = ticket
      phase = 'saving'

      return ticket
    },

    completeSave(ticket, nextDocumentId) {
      assertNotClosed()
      requireActiveTicket(ticket)

      ledger.commitSaveWindow()

      documentId = nextDocumentId
      activeSave = null
      phase = 'ready'
    },

    failSave(ticket) {
      assertNotClosed()
      requireActiveTicket(ticket)

      ledger.discardSaveWindow()

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
      return initialized
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
