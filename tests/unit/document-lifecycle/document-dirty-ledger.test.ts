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

    ledger.setSavePoint({ 'shape:a': { x: 1 } })
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

  /*
   * 保存窗口的入参是「这一次写进磁盘的内容」。它必须显式给出，而不是让账本
   * 去猜当前内容：保存是异步的，写盘用的快照与提交时刻的内容可能已经不同，
   * 这正是下面「保存期间继续编辑」那条用例要守住的差别。
   */
  it('is clean after a save that had no concurrent edits', () => {
    const ledger = createDocumentDirtyLedger()

    ledger.apply(added('shape:a', { x: 1 }))
    ledger.openSaveWindow({ 'shape:a': { x: 1 } })
    ledger.commitSaveWindow()

    expect(ledger.isDirty()).toBe(false)
  })

  it('stays dirty for edits that arrived while a save was in flight', () => {
    const ledger = createDocumentDirtyLedger()

    ledger.apply(added('shape:a', { x: 1 }))
    ledger.openSaveWindow({ 'shape:a': { x: 1 } })
    ledger.apply(updated('shape:a', { x: 1 }, { x: 9 }))
    ledger.commitSaveWindow()

    expect(ledger.isDirty()).toBe(true)
  })

  it('keeps the previous save point when a save is discarded', () => {
    const ledger = createDocumentDirtyLedger()

    ledger.apply(added('shape:a', { x: 1 }))
    ledger.openSaveWindow({ 'shape:a': { x: 1 } })
    ledger.discardSaveWindow()

    expect(ledger.isDirty()).toBe(true)
  })

  /*
   * 「新建画布立刻显示未保存圆点」那个缺陷的最小复现。
   *
   * tldraw 的历史刷新由 throttle 调度，编辑器初始化写入的记录会在 ready 之后
   * 才作为 added 到达，且 before 为 ABSENT。到达顺序不等于因果顺序，所以任何
   * 基于时间窗口的闸门都不可能对；账本只比内容。
   */
  it('stays clean when a diff re-reports save point records as newly added', () => {
    const ledger = createDocumentDirtyLedger()

    ledger.setSavePoint({
      'document:document': { gridSize: 10, name: '' },
      'page:page': { name: 'Page 1' },
    })

    ledger.apply(added('document:document', { gridSize: 10, name: '' }))
    ledger.apply(added('page:page', { name: 'Page 1' }))

    expect(ledger.isDirty()).toBe(false)
  })

  /* 上一条不能退化成「永远不脏」：同一记录换了值就必须脏。 */
  it('treats a save point record re-reported with a new value as dirty', () => {
    const ledger = createDocumentDirtyLedger()

    ledger.setSavePoint({ 'page:page': { name: 'Page 1' } })
    ledger.apply(added('page:page', { name: 'Renamed' }))

    expect(ledger.isDirty()).toBe(true)
  })
})
