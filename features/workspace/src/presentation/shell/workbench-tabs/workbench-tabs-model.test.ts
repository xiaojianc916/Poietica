import type { WorkbenchTabId } from '@poietica/agent-protocol'
import { describe, expect, it } from 'vitest'
import {
  encodeWorkbenchTabDomId,
  resolveWorkbenchTabCloseTarget,
  resolveWorkbenchTabInsertion,
  resolveWorkbenchTabKeyboardAction,
  type WorkbenchTabModelItem,
  type WorkbenchTabSlot,
} from './workbench-tabs-model'

describe('Workbench Tabs model', () => {
  const tabs: readonly WorkbenchTabModelItem[] = [
    createTab('first', true),

    createTab('second'),

    createTab('fixed', false),
  ]

  const slots: readonly WorkbenchTabSlot[] = [
    slot('first', 0, 100),

    slot('second', 100, 200),

    slot('fixed', 200, 300),
  ]

  it('moves and wraps keyboard navigation', () => {
    expect(resolveWorkbenchTabKeyboardAction(tabs, id('first'), 'ArrowLeft')).toEqual({
      type: 'activate',
      tabId: id('fixed'),
    })

    expect(resolveWorkbenchTabKeyboardAction(tabs, id('fixed'), 'ArrowRight')).toEqual({
      type: 'activate',
      tabId: id('first'),
    })
  })

  it('supports Home and End', () => {
    expect(resolveWorkbenchTabKeyboardAction(tabs, id('second'), 'Home')).toEqual({
      type: 'activate',
      tabId: id('first'),
    })

    expect(resolveWorkbenchTabKeyboardAction(tabs, id('second'), 'End')).toEqual({
      type: 'activate',
      tabId: id('fixed'),
    })
  })

  it('closes only closable tabs', () => {
    expect(resolveWorkbenchTabKeyboardAction(tabs, id('second'), 'Delete')).toEqual({
      type: 'close',
      tabId: id('second'),
    })

    expect(resolveWorkbenchTabKeyboardAction(tabs, id('fixed'), 'Delete')).toBeNull()
  })

  it('prefers the right tab after close', () => {
    expect(resolveWorkbenchTabCloseTarget(tabs, id('first'))).toBe(id('second'))
  })

  it('falls back to the left tab after closing the last tab', () => {
    expect(resolveWorkbenchTabCloseTarget(tabs, id('fixed'))).toBe(id('second'))
  })

  it('returns no close target when the last remaining tab closes', () => {
    expect(resolveWorkbenchTabCloseTarget([createTab('only', true)], id('only'))).toBeNull()
  })

  it('inserts after the last tab when the pointer passes its midpoint', () => {
    expect(resolveWorkbenchTabInsertion(slots, 0, 260)).toEqual({
      targetId: id('fixed'),
      side: 'after',
      index: 2,
    })
  })

  it('inserts before the first tab when the pointer moves left', () => {
    expect(resolveWorkbenchTabInsertion(slots, 2, 40)).toEqual({
      targetId: id('first'),
      side: 'before',
      index: 0,
    })
  })

  it('resolves a slot beyond the neighbour midpoint', () => {
    expect(resolveWorkbenchTabInsertion(slots, 0, 160)).toEqual({
      targetId: id('second'),
      side: 'after',
      index: 1,
    })
  })

  it('ignores a pointer that stays inside its own slot', () => {
    expect(resolveWorkbenchTabInsertion(slots, 0, 120)).toBeNull()
  })

  it.each([-1, 3])('rejects an out-of-range source index %s', (fromIndex) => {
    expect(resolveWorkbenchTabInsertion(slots, fromIndex, 120)).toBeNull()
  })

  it('rejects an empty strip', () => {
    expect(resolveWorkbenchTabInsertion([], 0, 0)).toBeNull()
  })

  it('encodes stable DOM identifiers', () => {
    expect(encodeWorkbenchTabDomId('canvas:hello/world')).toBe('canvas-hello-world')
  })
})

function createTab(value: string, canClose = true): WorkbenchTabModelItem {
  return {
    id: id(value),
    canClose,
  }
}

function slot(value: string, start: number, end: number): WorkbenchTabSlot {
  return {
    id: id(value),
    start,
    end,
  }
}

function id(value: string): WorkbenchTabId {
  return value as WorkbenchTabId
}
