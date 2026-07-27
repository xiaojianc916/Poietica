const BASE_TITLE = '未命名画布'

/*
 * 新建文档的默认名在同一会话内不重复，这是专业软件的既有心智。
 *
 * 命令（Mod+N）与标签栏的新建按钮必须共用这一处派生：两条管线各自命名时，
 * 键盘建出来的画布会全部叫同一个名字，按钮建出来的才带序号。
 */
export function nextUntitledCanvasTitle(
  tabs: readonly { readonly kind: string; readonly title: string }[],
): string {
  const taken = new Set(tabs.filter((tab) => tab.kind === 'canvas').map((tab) => tab.title))

  if (!taken.has(BASE_TITLE)) {
    return BASE_TITLE
  }

  let suffix = 2

  while (taken.has(`${BASE_TITLE} ${String(suffix)}`)) {
    suffix += 1
  }

  return `${BASE_TITLE} ${String(suffix)}`
}
