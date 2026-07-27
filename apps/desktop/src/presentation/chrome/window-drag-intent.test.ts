import { describe, expect, it } from 'vitest'

import { shouldStartWindowDragging } from './window-drag-intent'

/*
 * 用替身而不是真实 DOM：被测函数只需要 closest，替身让这些用例在无 DOM 的
 * 环境里也能跑，也就不存在"因为没有 jsdom 所以没测"的借口。
 */
function targetMatching(selectors: readonly string[]) {
  return {
    closest: (query: string) => {
      for (const selector of query.split(',')) {
        if (selectors.includes(selector)) {
          return {}
        }
      }

      return null
    },
  }
}

describe('shouldStartWindowDragging', () => {
  it('拖拽区域内的空白处应当拖动窗口', () => {
    expect(shouldStartWindowDragging(targetMatching(['[data-window-drag-region]']))).toBe(true)
  })

  it('拖拽区域内的按钮不得拖动窗口', () => {
    /*
     * 这条是回归本身。原生拖拽一旦开始就吞掉 click，标题栏上的按钮会
     * 彻底失灵且不报错。
     */
    const target = targetMatching(['[data-window-drag-region]', 'button'])

    expect(shouldStartWindowDragging(target)).toBe(false)
  })

  it('拖拽区域内的其它交互元素同样不得拖动窗口', () => {
    for (const selector of ['a', 'input', '[role="button"]', '[role="tab"]', '[role="menuitem"]']) {
      const target = targetMatching(['[data-window-drag-region]', selector])

      expect(shouldStartWindowDragging(target)).toBe(false)
    }
  })

  it('拖拽区域之外一律不拖动窗口', () => {
    expect(shouldStartWindowDragging(targetMatching([]))).toBe(false)
    expect(shouldStartWindowDragging(targetMatching(['button']))).toBe(false)
  })

  it('没有 closest 能力的目标一律不拖动窗口', () => {
    expect(shouldStartWindowDragging(null)).toBe(false)
    expect(shouldStartWindowDragging(undefined)).toBe(false)
    expect(shouldStartWindowDragging('text')).toBe(false)
    expect(shouldStartWindowDragging({})).toBe(false)
  })
})
