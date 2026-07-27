import { createDocumentSession } from '@poietica/editor-document'
import { describe, expect, it } from 'vitest'

/*
 * 脏状态由 tldraw 的记录内容与保存点比对得出，全文档快照只用于序列化持久化，
 * 因此这些用例直接使用 diff 契约。旧版本伪造 TLStoreSnapshot 并用类型断言
 * 强行通过，把一套已不存在的快照式 API 钉在了类型系统里。
 *
 * initialize 与 beginSave 的入参都是「磁盘上是什么」：前者是打开时的保存点，
 * 后者是这一次写进磁盘的内容。两者显式给出，会话内部就不需要任何时序猜测。
 */
function savedWith(...recordIds: readonly string[]): Readonly<Record<string, unknown>> {
  return Object.fromEntries(recordIds.map((recordId) => [recordId, { id: recordId }]))
}

/** 尚未保存过的新文档：磁盘上什么都没有。 */
const NEW_DOCUMENT = savedWith()

/** 已打开的既有文档：磁盘上本来就有内容，这一点必须被测到。 */
const OPENED_DOCUMENT = savedWith('shape:saved')

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

    session.initialize(NEW_DOCUMENT)

    expect(session.getSnapshot()).toEqual({
      phase: 'ready',
      persistence: 'clean',
      documentId: null,
    })
  })

  it('tracks an opaque document ID without storing a filesystem path', () => {
    const session = createDocumentSession('document-native-1')

    session.initialize(OPENED_DOCUMENT)

    expect(session.getDocumentId()).toBe('document-native-1')
    expect(session.getSnapshot()).toEqual({
      phase: 'ready',
      persistence: 'clean',
      documentId: 'document-native-1',
    })
  })

  /* 打开一份非空文档不算改动：内容与保存点一致。 */
  it('stays clean right after opening a document that already has content', () => {
    const session = createDocumentSession('document-native-1')

    session.initialize(OPENED_DOCUMENT)
    session.recordDocumentChange(changesAdding('shape:saved'))

    expect(session.isDirty()).toBe(false)
  })

  it('becomes dirty after a document change', () => {
    const session = createDocumentSession(null)

    session.initialize(NEW_DOCUMENT)
    session.recordDocumentChange(changesAdding('shape:1'))

    expect(session.isDirty()).toBe(true)
    expect(session.getSnapshot().persistence).toBe('dirty')
  })

  /*
   * 撤销会以不同的对象标识重建等价记录，因此账本按结构比较判定记录已回到
   * 保存点。新增后再删除正是这条路径：保存点是 ABSENT，删除后又是 ABSENT。
   */
  it('returns to clean when a change is undone back to the saved value', () => {
    const session = createDocumentSession(null)

    session.initialize(NEW_DOCUMENT)
    session.recordDocumentChange(changesAdding('shape:1'))

    expect(session.isDirty()).toBe(true)

    session.recordDocumentChange(changesRemoving('shape:1'))

    expect(session.isDirty()).toBe(false)
    expect(session.getSnapshot().persistence).toBe('clean')
  })

  /*
   * 键序无关只有在「该记录本来就属于保存点」时才是这条用例要测的东西。
   * 原先它初始化成空文档，于是比较的是「一条不在保存点里的记录」，能通过
   * 靠的是旧账本逐 diff 折叠 before/after 的巧合，而不是相等判定本身。
   */
  it('ignores object key insertion order', () => {
    const session = createDocumentSession('document-native-1')

    session.initialize({ 'shape:1': { alpha: 1, beta: 2 } })
    session.recordDocumentChange(
      changesUpdating('shape:1', { alpha: 1, beta: 2 }, { beta: 2, alpha: 1 }),
    )

    expect(session.isDirty()).toBe(false)
  })

  it('stays dirty when editing continues during save', () => {
    const session = createDocumentSession(null)

    session.initialize(NEW_DOCUMENT)
    session.recordDocumentChange(changesAdding('shape:1'))

    const ticket = session.beginSave(savedWith('shape:1'))

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

    session.initialize(NEW_DOCUMENT)
    session.recordDocumentChange(changesAdding('shape:1'))

    const ticket = session.beginSave(savedWith('shape:1'))

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

    session.initialize(OPENED_DOCUMENT)
    session.recordDocumentChange(changesAdding('shape:1'))

    const ticket = session.beginSave(savedWith('shape:saved', 'shape:1'))

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

    session.initialize(OPENED_DOCUMENT)
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

    session.initialize(OPENED_DOCUMENT)

    const ticket = session.beginSave(OPENED_DOCUMENT)

    session.failSave(ticket)

    expect(session.getSnapshot()).toEqual({
      phase: 'save-failed',
      persistence: 'failed',
      documentId: 'document-native-1',
    })
  })
})
