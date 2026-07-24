/**
 * Hybrid Canvas workspace product-layout contract.
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
} as const

export type WorkspaceLayout = typeof WORKSPACE_LAYOUT
