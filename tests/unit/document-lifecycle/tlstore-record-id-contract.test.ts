import { createTLStore, defaultBindingUtils, defaultShapeUtils } from 'tldraw'
import { describe, expect, it } from 'vitest'

/*
 * editor-session.ts decides whether a store diff touches a page from the diff
 * keys alone, using the 'page:' record id prefix, instead of materialising the
 * diff containers and reading typeName off each record.
 *
 * That is a load-bearing assumption about a third-party schema. It is pinned
 * here so a tldraw upgrade that changes record id formatting fails this test
 * rather than silently stopping page navigation from updating.
 */
describe('TLStore record id prefix contract', () => {
  function recordsByTypeName(): ReadonlyArray<readonly [string, string]> {
    const store = createTLStore({
      shapeUtils: defaultShapeUtils,
      bindingUtils: defaultBindingUtils,
    })

    return Object.entries(store.getStoreSnapshot().store).map(
      ([id, record]) => [id, (record as { readonly typeName: string }).typeName] as const,
    )
  }

  it('prefixes every page record id with "page:"', () => {
    const pages = recordsByTypeName().filter(([, typeName]) => typeName === 'page')

    expect(pages.length).toBeGreaterThan(0)

    for (const [id] of pages) {
      expect(id.startsWith('page:')).toBe(true)
    }
  })

  it('never gives a non-page record a "page:" prefix', () => {
    const others = recordsByTypeName().filter(([, typeName]) => typeName !== 'page')

    expect(others.length).toBeGreaterThan(0)

    for (const [id] of others) {
      expect(id.startsWith('page:')).toBe(false)
    }
  })
})
