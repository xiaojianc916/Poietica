import { createDocumentDirtyLedger, type DocumentRecordChanges } from '@poietica/editor-document'
import { describe, expect, it } from 'vitest'

function added(id: string, value: unknown): DocumentRecordChanges {
  return { added: { [id]: value }, updated: {}, removed: {} }
}

function updated(id: string, before: unknown, after: unknown): DocumentRecordChanges {
  return { added: {}, updated: { [id]: [before, after] }, removed: {} }
}

function removed(id: string, value: unknown): DocumentRecordChanges {
  return { added: {}, updated: {}, removed: { [id]: value } }
}

describe('document dirty ledger', () => {
  it('starts clean', () => {
    expect(createDocumentDirtyLedger().isDirty()).toBe(false)
  })

  it('reports a created record as dirty', () => {
    const ledger = createDocumentDirtyLedger()

    ledger.apply(added('shape:a', { x: 1 }))

    expect(ledger.isDirty()).toBe(true)
  })

  it('reports a deleted record as dirty', () => {
    const ledger = createDocumentDirtyLedger()

    ledger.apply(removed('shape:a', { x: 1 }))

    expect(ledger.isDirty()).toBe(true)
  })

  /*
   * Undo recreates records under a fresh object identity. Reference equality
   * would report this document as modified and prompt the user to save work
   * that is already saved.
   */
  it('reports a record restored to its saved value as clean across object identity', () => {
    const ledger = createDocumentDirtyLedger()

    ledger.apply(updated('shape:a', { x: 1, meta: { tag: 'n' } }, { x: 2, meta: { tag: 'n' } }))

    expect(ledger.isDirty()).toBe(true)

    ledger.apply(updated('shape:a', { x: 2, meta: { tag: 'n' } }, { x: 1, meta: { tag: 'n' } }))

    expect(ledger.isDirty()).toBe(false)
  })

  it('is clean after a save that had no concurrent edits', () => {
    const ledger = createDocumentDirtyLedger()

    ledger.apply(added('shape:a', { x: 1 }))
    ledger.openSaveWindow()
    ledger.commitSaveWindow()

    expect(ledger.isDirty()).toBe(false)
  })

  it('stays dirty for edits that arrived while a save was in flight', () => {
    const ledger = createDocumentDirtyLedger()

    ledger.apply(added('shape:a', { x: 1 }))
    ledger.openSaveWindow()
    ledger.apply(updated('shape:a', { x: 1 }, { x: 9 }))
    ledger.commitSaveWindow()

    expect(ledger.isDirty()).toBe(true)
  })

  it('keeps the previous save point when a save is discarded', () => {
    const ledger = createDocumentDirtyLedger()

    ledger.apply(added('shape:a', { x: 1 }))
    ledger.openSaveWindow()
    ledger.discardSaveWindow()

    expect(ledger.isDirty()).toBe(true)
  })
})
