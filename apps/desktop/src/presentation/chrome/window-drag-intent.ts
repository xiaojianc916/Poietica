/*
 * 窗口拖拽意图的判断。
 *
 * 与 React 无关，也不依赖 DOM 全局对象，因此可以直接用单元测试覆盖。它此前
 * 内联在 DesktopTitleBar 里，任何测试都触及不到，于是判断写错时没有任何
 * 检查会失败——标题栏上所有按钮同时失灵，却全绿。
 */

/*
 * 只有显式标注的区域才发起窗口拖拽。这比"哪些元素不能拖"的黑名单可靠：
 * 黑名单每引入一种新交互元素就会漏一条。
 */
const WINDOW_DRAG_REGION_SELECTOR = '[data-window-drag-region]'

/*
 * 拖拽区域完全可以包住交互元素（例如整条标题栏都被标注为可拖拽），所以
 * "位于拖拽区域内"不足以决定是否拖窗口。这两个条件是正交的，交互元素
 * 必须先被排除。
 *
 * 代价极高：原生拖拽一旦开始，WebView 就不再派发 click，按钮会变成完全
 * 无反应，而且没有报错、没有警告，只有沉默。
 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/*
 * 只要求目标具备 closest 能力，不做 instanceof 检查：跨 realm 的元素会让
 * instanceof 失效，而且鸭子类型让本模块可以在无 DOM 的环境中被测试。
 */
interface DragIntentTarget {
  readonly closest: (selectors: string) => unknown
}

function hasClosest(value: unknown): value is DragIntentTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DragIntentTarget).closest === 'function'
  )
}

/**
 * 判断一次鼠标按下是否应当发起窗口拖拽。
 *
 * 顺序不可颠倒：先排除交互元素，再确认位于拖拽区域内。
 */
export function shouldStartWindowDragging(target: unknown): boolean {
  if (!hasClosest(target)) {
    return false
  }

  if (target.closest(INTERACTIVE_SELECTOR) !== null) {
    return false
  }

  return target.closest(WINDOW_DRAG_REGION_SELECTOR) !== null
}
