import { isPageId, PageRecordType, pageIdValidator } from '@tldraw/tlschema'
import { describe, expect, it } from 'vitest'

/*
 * editor-session.ts decides whether a store diff touches a page from the diff
 * keys alone, comparing each key against the literal prefix 'page:', instead of
 * materialising the diff containers and reading typeName off every record.
 *
 * That is a load-bearing assumption about a third-party schema, so it is pinned
 * against tldraw's own page-id primitives rather than against a hand-rolled
 * restatement of the rule. tlschema builds page ids with
 * createRecordType<TLPage>('page', ...) and exposes isPageId and
 * pageIdValidator as public API; if that id scheme ever changes, these
 * assertions fail here instead of page navigation silently going dead.
 *
 * Deliberately no TLStore is constructed. Instantiating the full shape and
 * binding util graph to observe a string prefix tests the wrong layer, and
 * forces an 'as unknown as' cast to satisfy exactOptionalPropertyTypes.
 */

/** Mirrors PAGE_RECORD_ID_PREFIX in editor/core/src/runtime/editor-session.ts. */
const PAGE_RECORD_ID_PREFIX = 'page:'

describe('TLStore page record id prefix contract', () => {
  it('generates page ids carrying the prefix editor-session matches on', () => {
    const id: string = PageRecordType.createId()

    expect(id.startsWith(PAGE_RECORD_ID_PREFIX)).toBe(true)
    expect(isPageId(id)).toBe(true)
    expect(pageIdValidator.isValid(id)).toBe(true)
  })

  it('accepts every prefixed id that editor-session would treat as a page', () => {
    for (const id of ['page:main', 'page:abc123', 'page:0']) {
      expect(id.startsWith(PAGE_RECORD_ID_PREFIX)).toBe(true)
      expect(isPageId(id)).toBe(true)
    }
  })

  /*
   * The reverse direction is what makes the prefix test sound: a key that
   * editor-session skips must genuinely not be a page.
   */
  it('rejects every id lacking the prefix', () => {
    for (const id of [
      'shape:abc123',
      'asset:abc123',
      'binding:abc123',
      'document:document',
      'instance:instance',
      'camera:page1',
      'pointer:pointer',
    ]) {
      expect(id.startsWith(PAGE_RECORD_ID_PREFIX)).toBe(false)
      expect(isPageId(id)).toBe(false)
    }
  })

  /*
   * startsWith is a weaker predicate than tldraw's guard, so the two could
   * disagree on ids that merely begin with the letters "page". They must not.
   */
  it('does not confuse a lookalike type name with the page prefix', () => {
    for (const id of ['pages:abc123', 'pagebreak:abc123', 'page-1:abc123']) {
      expect(id.startsWith(PAGE_RECORD_ID_PREFIX)).toBe(false)
      expect(isPageId(id)).toBe(false)
    }
  })

  it('derives the prefix from the record type name rather than restating it', () => {
    expect(`${PageRecordType.typeName}:`).toBe(PAGE_RECORD_ID_PREFIX)
  })
})
