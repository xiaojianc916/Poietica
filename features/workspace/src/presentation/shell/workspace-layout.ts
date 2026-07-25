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
