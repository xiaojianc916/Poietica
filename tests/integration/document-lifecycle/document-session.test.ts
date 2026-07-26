import { createDocumentSession } from '@poietica/editor-document'
import { describe, expect, it } from 'vitest'

/*
 * 脏状态由 tldraw 的记录 diff 折叠得出，全文档快照只用于序列化持久化，
 * 因此这些用例直接使用 diff 契约。旧版本伪造 TLStoreSnapshot 并用类型断言
 * 强行通过，把一套已不存在的快照式 API 钉在了类型系统里。
 */
function changesAdding(recordId: string, value: unknown = { id: recordId }) {
  return {
    added: { [recordId]: value },
    updated: {},
    removed: {},
  }
}

function changesRemoving(recordId: string, value: unknown = { id: recordId }) {
  return {
    added: {},
    updated: {},
    removed: { [recordId]: value },
  }
}

function changesUpdating(recordId: string, before: unknown, after: unknown) {
  return {
    added: {},
    updated: { [recordId]: [before, after] as const },
    removed: {},
  }
}

describe('DocumentSession', () => {
  it('initializes a new unsaved document as clean', () => {
    const session = createDocumentSession(null)

    session.initialize()

    expect(session.getSnapshot()).toEqual({
      phase: 'ready',
      persistence: 'clean',
      documentId: null,
    })
  })

  it('tracks an opaque document ID without storing a filesystem path', () => {
    const session = createDocumentSession('document-native-1')

    session.initialize()

    expect(session.getDocumentId()).toBe('document-native-1')
    expect(session.getSnapshot()).toEqual({
      phase: 'ready',
      persistence: 'clean',
      documentId: 'document-native-1',
    })
  })

  it('becomes dirty after a document change', () => {
    const session = createDocumentSession(null)

    session.initialize()
    session.recordDocumentChange(changesAdding('shape:1'))

    expect(session.isDirty()).toBe(true)
    expect(session.getSnapshot().persistence).toBe('dirty')
  })

  /*
   * 撤销会以不同的对象标识重建等价记录，因此账本按结构比较判定记录已回到
   * 保存点。新增后再删除正是这条路径：基线是 ABSENT，删除后又是 ABSENT。
   */
  it('returns to clean when a change is undone back to the saved value', () => {
    const session = createDocumentSession(null)

    session.initialize()
    session.recordDocumentChange(changesAdding('shape:1'))

    expect(session.isDirty()).toBe(true)

    session.recordDocumentChange(changesRemoving('shape:1'))

    expect(session.isDirty()).toBe(false)
    expect(session.getSnapshot().persistence).toBe('clean')
  })

  it('ignores object key insertion order', () => {
    const session = createDocumentSession(null)

    session.initialize()
    session.recordDocumentChange(
      changesUpdating('shape:1', { alpha: 1, beta: 2 }, { beta: 2, alpha: 1 }),
    )

    expect(session.isDirty()).toBe(false)
  })

  it('stays dirty when editing continues during save', () => {
    const session = createDocumentSession(null)

    session.initialize()
    session.recordDocumentChange(changesAdding('shape:1'))

    const ticket = session.beginSave()

    session.recordDocumentChange(changesAdding('shape:2'))
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

    session.initialize()
    session.recordDocumentChange(changesAdding('shape:1'))

    const ticket = session.beginSave()

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

    session.initialize()
    session.recordDocumentChange(changesAdding('shape:1'))

    const ticket = session.beginSave()

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

    session.initialize()
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

    session.initialize()

    const ticket = session.beginSave()

    session.failSave(ticket)

    expect(session.getSnapshot()).toEqual({
      phase: 'save-failed',
      persistence: 'failed',
      documentId: 'document-native-1',
    })
  })
})
