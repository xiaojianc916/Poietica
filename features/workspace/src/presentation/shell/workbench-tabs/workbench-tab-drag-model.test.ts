import { describe, expect, it } from 'vitest'
import type { WorkbenchTabId } from '../../../contracts/workbench-contract'
import { resolveWorkbenchTabDrop } from './workbench-tab-drag-model'

describe('Workbench tab drag model', () => {
  it('uses the current drag session identity', () => {
    expect(
      resolveWorkbenchTabDrop({
        sessionTabId: id('canvas-a'),

        transferredTabId: 'external-value',

        targetIndex: 2,
        tabCount: 4,
      }),
    ).toEqual({
      tabId: id('canvas-a'),
      targetIndex: 2,
    })
  })

  it('falls back to the DataTransfer identity', () => {
    expect(
      resolveWorkbenchTabDrop({
        sessionTabId: null,

        transferredTabId: ' canvas-b ',

        targetIndex: 1,
        tabCount: 3,
      }),
    ).toEqual({
      tabId: id('canvas-b'),
      targetIndex: 1,
    })
  })

  it('rejects an empty identity', () => {
    expect(
      resolveWorkbenchTabDrop({
        sessionTabId: null,
        transferredTabId: '   ',
        targetIndex: 0,
        tabCount: 2,
      }),
    ).toBeNull()
  })

  it.each([-1, 3, 1.5, Number.NaN])('rejects invalid target index %s', (targetIndex) => {
    expect(
      resolveWorkbenchTabDrop({
        sessionTabId: id('canvas-a'),

        transferredTabId: '',

        targetIndex,
        tabCount: 3,
      }),
    ).toBeNull()
  })

  it('rejects every target when no tabs exist', () => {
    expect(
      resolveWorkbenchTabDrop({
        sessionTabId: id('canvas-a'),

        transferredTabId: '',

        targetIndex: 0,
        tabCount: 0,
      }),
    ).toBeNull()
  })
})

function id(value: string): WorkbenchTabId {
  return value as WorkbenchTabId
}
