import { describe, expect, it } from 'vitest'
import type { WorkbenchTabId } from '../../../contracts/workbench-contract'
import {
  encodeWorkbenchTabDomId,
  resolveWorkbenchTabCloseTarget,
  resolveWorkbenchTabDrop,
  resolveWorkbenchTabKeyboardAction,
  type WorkbenchTabModelItem,
} from './workbench-tabs-model'

describe('Workbench Tabs model', () => {
  const tabs: readonly WorkbenchTabModelItem[] = [
    createTab('first', true),

    createTab('second'),

    createTab('fixed', false),
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

  it('resolves a local drag session', () => {
    expect(
      resolveWorkbenchTabDrop({
        sessionTabId: id('first'),

        transferredTabId: '',

        targetIndex: 2,
        tabCount: 3,
      }),
    ).toEqual({
      tabId: id('first'),
      targetIndex: 2,
    })
  })

  it('uses a transferred drag identity as fallback', () => {
    expect(
      resolveWorkbenchTabDrop({
        sessionTabId: null,

        transferredTabId: ' second ',

        targetIndex: 1,
        tabCount: 3,
      }),
    ).toEqual({
      tabId: id('second'),
      targetIndex: 1,
    })
  })

  it.each([-1, 3, 1.5, Number.NaN])('rejects invalid drop target %s', (targetIndex) => {
    expect(
      resolveWorkbenchTabDrop({
        sessionTabId: id('first'),

        transferredTabId: '',

        targetIndex,
        tabCount: 3,
      }),
    ).toBeNull()
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

function id(value: string): WorkbenchTabId {
  return value as WorkbenchTabId
}
