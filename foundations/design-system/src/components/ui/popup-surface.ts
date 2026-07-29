/*
 * 浮层表面与定位层的唯一来源。
 *
 * Menu 与 Select 是同一种"浮在 chrome 之上的临时表面"，此前两个文件各写
 * 一遍，已经漂出两处差异：Menu 缺 ease-standard；Select 用
 * calc(--ui-z-dialog + 1) 绕过了栈序表，于是只有 Select 逃过了
 * "对话框内弹层被遮挡"，Menu 一直是坏的。差异不是设计意图，是抄漏。
 *
 * 阴影刻意留在调用处：Menu 用 md、Select 用 xl 是尚未裁决的视觉档位，
 * 收进这里会把"待决策"伪装成"已统一"。
 */
export const popupSurfaceClassName = [
  'overflow-hidden',
  'rounded-md border border-divider',
  'bg-popover text-popover-foreground',
  'outline-none',
  'origin-[var(--transform-origin)]',
  'transition-[transform,scale,opacity]',
  'duration-[var(--ui-duration-fast)]',
  'ease-[var(--ui-ease-standard)]',
  'data-[starting-style]:scale-95',
  'data-[starting-style]:opacity-0',
  'data-[ending-style]:scale-95',
  'data-[ending-style]:opacity-0',
].join(' ')

/* 浮层一律落在 popover 层，组件内不得就地做层级算术。 */
export const popupPositionerClassName = 'z-[var(--ui-z-popover)] outline-none'
