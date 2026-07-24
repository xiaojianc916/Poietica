import { describe, expect, it } from 'vitest'
import type { WorkbenchTabId } from '../../../contracts/workbench-contract'
import {
  encodeWorkbenchTabDomId,
  resolveWorkbenchTabKeyboardAction,
  type WorkbenchTabNavigationItem,
} from './workbench-tab-model'

describe('Workbench tab keyboard model', () => {
  const tabs: readonly WorkbenchTabNavigationItem[] = [
    createTab('first'),
    createTab('second'),
    createTab('fixed', false),
  ]

  it('moves to the next tab', () => {
    expect(resolveWorkbenchTabKeyboardAction(tabs, id('first'), 'ArrowRight')).toEqual({
      type: 'activate',
      tabId: id('second'),
    })
  })

  it('wraps keyboard navigation', () => {
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

  it('ignores unsupported keys and unknown tabs', () => {
    expect(resolveWorkbenchTabKeyboardAction(tabs, id('second'), 'Enter')).toBeNull()

    expect(resolveWorkbenchTabKeyboardAction(tabs, id('missing'), 'ArrowRight')).toBeNull()
  })

  it('encodes stable DOM identifiers', () => {
    expect(encodeWorkbenchTabDomId('canvas:hello/world')).toBe('canvas-hello-world')
  })
})

function createTab(value: string, canClose = true): WorkbenchTabNavigationItem {
  return {
    id: id(value),
    canClose,
  }
}

function id(value: string): WorkbenchTabId {
  return value as WorkbenchTabId
}
