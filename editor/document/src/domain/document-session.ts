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
   * 用文档当前的完整记录声明保存点，文档随即是干净的。
   *
   * 必须传入记录：脏状态是"当前内容与保存点内容"的比较，不是"自某时刻起是否
   * 收到过 diff"。tldraw 的 Store 会把历史 diff 节流后异步冲刷，初始化产生的
   * diff 可能在此之后才到达，并把已经存在的记录重报为 added。只有内容比较对
   * 这种到达顺序免疫。
   */
  readonly initialize: (records: Readonly<Record<string, unknown>>) => void

  /**
   * Folds a tldraw Store diff into dirty tracking.
   *
   * This path is incremental by construction. Full snapshots exist only to be
   * serialised for persistence, never to answer dirty state.
   */
  readonly recordDocumentChange: (changes: DocumentRecordChanges) => void

  /**
   * 开始一次保存。传入的必须是调用方即将写入磁盘的那份记录，它会在提交时整体
   * 成为新的保存点。调用方本来就已经捕获了它，因此这里没有额外成本。
   */
  readonly beginSave: (savedRecords: Readonly<Record<string, unknown>>) => DocumentSaveTicket

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
    initialize(records) {
      assertNotClosed()

      if (phase !== 'initializing') {
        throw new Error('DOCUMENT_SESSION_ALREADY_INITIALIZED')
      }

      ledger.setSavePoint(records)
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

    beginSave(savedRecords) {
      assertNotClosed()
      requireInitialized()

      if (phase === 'saving') {
        throw new Error('DOCUMENT_SESSION_SAVE_ALREADY_ACTIVE')
      }

      /*
       * 传进来的就是即将落盘的那份记录，所以它正是待定保存点。窗口期间的并发
       * 编辑照旧相对当前保存点维护，提交时再按新保存点核对一遍。
       */
      ledger.openSaveWindow(savedRecords)

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
