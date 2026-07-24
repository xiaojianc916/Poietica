/**
 * TypeScript references to canonical CSS tokens.
 *
 * Values intentionally remain CSS var() expressions so
 * numeric or color values are not duplicated in TypeScript.
 */
export const uiTokens = {
  color: {
    background: 'var(--ui-background)',
    foreground: 'var(--ui-foreground)',
    surface: 'var(--ui-surface)',
    canvas: 'var(--ui-canvas)',
    chrome: 'var(--ui-chrome)',
    sidebar: 'var(--ui-sidebar)',
    divider: 'var(--ui-divider)',
    border: 'var(--ui-border)',
    primary: 'var(--ui-primary)',
    muted: 'var(--ui-muted)',
    accent: 'var(--ui-accent)',
    destructive: 'var(--ui-destructive)',
    warning: 'var(--ui-warning)',
    success: 'var(--ui-success)',
    info: 'var(--ui-info)',
    ring: 'var(--ui-ring)',
  },

  radius: {
    xs: 'var(--ui-radius-xs)',
    sm: 'var(--ui-radius-sm)',
    md: 'var(--ui-radius-md)',
    lg: 'var(--ui-radius-lg)',
    xl: 'var(--ui-radius-xl)',
    full: 'var(--ui-radius-full)',
  },

  shadow: {
    xs: 'var(--ui-shadow-xs)',
    sm: 'var(--ui-shadow-sm)',
    md: 'var(--ui-shadow-md)',
    lg: 'var(--ui-shadow-lg)',
    xl: 'var(--ui-shadow-xl)',
  },

  duration: {
    instant: 'var(--ui-duration-instant)',
    fast: 'var(--ui-duration-fast)',
    normal: 'var(--ui-duration-normal)',
    slow: 'var(--ui-duration-slow)',
    emphasized: 'var(--ui-duration-emphasized)',
  },

  easing: {
    standard: 'var(--ui-ease-standard)',
    emphasized: 'var(--ui-ease-emphasized)',
    exit: 'var(--ui-ease-exit)',
  },

  layer: {
    canvas: 'var(--ui-z-canvas)',
    content: 'var(--ui-z-content)',
    chrome: 'var(--ui-z-chrome)',
    floating: 'var(--ui-z-floating)',
    popover: 'var(--ui-z-popover)',
    dialog: 'var(--ui-z-dialog)',
    toast: 'var(--ui-z-toast)',
    fatal: 'var(--ui-z-fatal)',
  },
} as const

export type UiTokens = typeof uiTokens
