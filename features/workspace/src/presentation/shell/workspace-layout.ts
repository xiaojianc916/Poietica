/**
 * Poietica workspace product-layout contract.
 *
 * This module is the single source of truth for
 * Workspace shell dimensions. These values are
 * product semantics and do not belong to the
 * cross-feature design system.
 */
export const WORKSPACE_LAYOUT = {
  sidebar: {
    /*
     * 侧边栏导航图标的中线距侧边栏左边界的距离。
     *
     * 标题栏的侧边栏开合按钮和导航项图标分属两个包，靠这一个令牌对齐，
     * 而不是各自写一遍内边距——那样任何一侧调整都会静默错位。
     */
    navIconCenter: 24,

    /*
     * 侧边栏收起后，左上角开合按钮容器的兜底宽度。
     *
     * 左上角区域取 max(侧边栏列宽, 这个值)：展开时列宽胜出，右边界与侧边栏
     * 右边界重合，竖线自然对齐；收起时列宽归零、由它托底，按钮不会没有落脚
     * 点。按钮因此始终留在正常流里——绝对定位能保住位置，却会溢出到标签条
     * 上被它的层叠上下文盖掉，那正是上一版的故障。
     *
     * 取值由几何推出而非拍板：navIconCenter 左侧留白 + 按钮自身 + 对称的
     * 右侧留白。
     */
    toggleZoneWidth: 44,
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
