import { createDocumentSession } from '@poietica/document'
import type { TLStoreSnapshot } from 'tldraw'
import { describe, expect, it } from 'vitest'

function snapshot(documentValue: unknown): TLStoreSnapshot {
  /*
   * DocumentSession accepts only persistable TLStore document state. Tests no
   * longer manufacture an editor session snapshot.
   */
  return documentValue as TLStoreSnapshot
}

describe('DocumentSession', () => {
  it('initializes a new unsaved document as clean', () => {
    const session = createDocumentSession(null)

    session.initialize(
      snapshot({
        records: {
          page: {
            id: 'page:1',
          },
        },
      }),
    )

    expect(session.getSnapshot()).toEqual({
      phase: 'ready',
      persistence: 'clean',
      documentId: null,
    })
  })

  it('tracks an opaque document ID without storing a filesystem path', () => {
    const session = createDocumentSession('document-native-1')

    session.initialize(snapshot({ shapes: [] }))

    expect(session.getDocumentId()).toBe('document-native-1')
    expect(session.getSnapshot()).toEqual({
      phase: 'ready',
      persistence: 'clean',
      documentId: 'document-native-1',
    })
  })

  it('becomes dirty after a document change', () => {
    const session = createDocumentSession(null)

    session.initialize(snapshot({ shapes: [] }))

    session.recordDocumentChange(
      snapshot({
        shapes: [{ id: 'shape:1' }],
      }),
    )

    expect(session.isDirty()).toBe(true)
    expect(session.getSnapshot().persistence).toBe('dirty')
  })

  it('returns to clean when undo restores the saved checkpoint', () => {
    const session = createDocumentSession(null)

    const baseline = snapshot({ shapes: [] })

    session.initialize(baseline)

    session.recordDocumentChange(
      snapshot({
        shapes: [{ id: 'shape:1' }],
      }),
    )

    expect(session.isDirty()).toBe(true)

    session.recordDocumentChange(baseline)

    expect(session.isDirty()).toBe(false)
    expect(session.getSnapshot().persistence).toBe('clean')
  })

  it('ignores object key insertion order', () => {
    const session = createDocumentSession(null)

    session.initialize(
      snapshot({
        alpha: 1,
        beta: 2,
      }),
    )

    session.recordDocumentChange(
      snapshot({
        beta: 2,
        alpha: 1,
      }),
    )

    expect(session.isDirty()).toBe(false)
  })

  it('stays dirty when editing continues during save', () => {
    const session = createDocumentSession(null)

    session.initialize(snapshot({ shapes: [] }))

    const ticket = session.beginSave(
      snapshot({
        shapes: [{ id: 'shape:1' }],
      }),
    )

    session.recordDocumentChange(
      snapshot({
        shapes: [{ id: 'shape:1' }, { id: 'shape:2' }],
      }),
    )

    session.completeSave(ticket, 'document-native-1')

    expect(session.isDirty()).toBe(true)
    expect(session.getSnapshot()).toEqual({
      phase: 'ready',
      persistence: 'dirty',
      documentId: 'document-native-1',
    })
  })

  it('becomes clean after first Save As assigns a native document ID', () => {
    const session = createDocumentSession(null)

    const current = snapshot({
      shapes: [{ id: 'shape:1' }],
    })

    session.initialize(snapshot({ shapes: [] }))
    session.recordDocumentChange(current)

    const ticket = session.beginSave(current)

    session.completeSave(ticket, 'document-native-created')

    expect(session.isDirty()).toBe(false)
    expect(session.getSnapshot()).toEqual({
      phase: 'ready',
      persistence: 'clean',
      documentId: 'document-native-created',
    })
  })

  it('restores the exact pre-close phase after native release cancellation', () => {
    const session = createDocumentSession('document-native-1')

    const current = snapshot({
      shapes: [{ id: 'shape:1' }],
    })

    session.initialize(snapshot({ shapes: [] }))

    const ticket = session.beginSave(current)
    session.failSave(ticket)

    expect(session.getSnapshot()).toEqual({
      phase: 'save-failed',
      persistence: 'failed',
      documentId: 'document-native-1',
    })

    session.beginClosing()

    expect(session.getSnapshot()).toEqual({
      phase: 'closing',
      persistence: 'dirty',
      documentId: 'document-native-1',
    })

    session.cancelClosing()

    expect(session.getSnapshot()).toEqual({
      phase: 'save-failed',
      persistence: 'failed',
      documentId: 'document-native-1',
    })
  })

  it('restores ready state after a clean close cancellation', () => {
    const session = createDocumentSession('document-native-1')

    session.initialize(snapshot({ shapes: [] }))
    session.beginClosing()
    session.cancelClosing()

    expect(session.getSnapshot()).toEqual({
      phase: 'ready',
      persistence: 'clean',
      documentId: 'document-native-1',
    })
  })

  it('enters failed state after a native save failure', () => {
    const session = createDocumentSession('document-native-1')

    const current = snapshot({ shapes: [] })

    session.initialize(current)

    const ticket = session.beginSave(current)

    session.failSave(ticket)

    expect(session.getSnapshot()).toEqual({
      phase: 'save-failed',
      persistence: 'failed',
      documentId: 'document-native-1',
    })
  })
})
