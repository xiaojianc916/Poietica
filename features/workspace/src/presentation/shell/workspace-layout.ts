/**
 * Poietica workspace product-layout contract.
 *
 * This module is the single source of truth for
 * Workspace shell dimensions. These values are
 * product semantics and do not belong to the
 * cross-feature design system.
 */
export const WORKSPACE_LAYOUT = {
  activityRail: {
    width: 48,
  },

  sidebar: {
    minWidth: 220,
    maxWidth: 420,
    defaultWidth: 280,
  },

  inspector: {
    width: 276,
  },

  /*
   * 布局断点以 CSS 媒体查询字符串表达，由 matchMedia 订阅：浏览器只在
   * 跨越断点时通知一次，不需要在每一帧 resize 上重新计算布局模式。
   */
  breakpoints: {
    compact: '(min-width: 900px)',
    wide: '(min-width: 1280px)',
  },

  chrome: {
    height: 36,
  },

  statusBar: {
    height: 30,
  },
  /*
   * Runtime layout animation contract.
   *
   * Motion uses seconds and numeric cubic-bezier tuples,
   * so these values intentionally remain TypeScript
   * product tokens instead of CSS duration strings.
   */
  motion: {
    layoutDurationSeconds: 0.22,
    layoutEase: [0.2, 0, 0, 1],
  },
} as const

export type WorkspaceLayout = typeof WORKSPACE_LAYOUT
