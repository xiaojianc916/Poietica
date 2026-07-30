import { type MotionStyle, motion, useReducedMotion } from 'motion/react'
import type { ReactNode, Ref } from 'react'
import { WORKSPACE_LAYOUT } from './workspace-layout'

import './workspace-shell.css'

type WorkspaceMotionStyle = MotionStyle & Record<`--${string}`, string | number>

const WORKSPACE_LAYOUT_STYLE: WorkspaceMotionStyle = {
  '--workspace-sidebar-nav-icon-center': `${WORKSPACE_LAYOUT.sidebar.navIconCenter}px`,

  /*
   * 布局动画时长同时给 motion 的 transition 和 CSS 侧的过渡使用，两边共用
   * 一条时间轴：否则标题栏的竖线渐隐会和面板滑动各跑各的节奏。
   */
  '--workspace-layout-duration': `${WORKSPACE_LAYOUT.motion.layoutDurationSeconds}s`,
  '--chrome-height': `${WORKSPACE_LAYOUT.chrome.height}px`,
  '--status-height': `${WORKSPACE_LAYOUT.statusBar.height}px`,
}

export interface WorkspaceFrameProps {
  readonly rootRef?: Ref<HTMLDivElement>
  readonly chrome: ReactNode
  readonly sidebar: ReactNode
  readonly canvas: ReactNode
  readonly inspector: ReactNode
  readonly statusBar: ReactNode
  readonly overlays?: ReactNode
  readonly sidebarColumnWidth: number
  readonly inspectorColumnWidth: number
  readonly hasStatusBar: boolean
  readonly isSidebarDocked: boolean
  readonly isInspectorDocked: boolean
  readonly disableLayoutAnimation?: boolean
}

/**
 * 外壳栅格的动画所有者。
 *
 * 行与列的模板、命名区域、竖线与空列的指针穿透都在 workspace-shell.css 里，
 * 这里只把三个状态位挂到根元素上——此前这些几何以 gridTemplateColumns /
 * gridTemplateRows 两个字符串 prop 从外壳传入，同时区域组件又各自内联格位，
 * 同一份坐标散落在四个文件。
 */
export function WorkspaceFrame({
  rootRef,
  chrome,
  sidebar,
  canvas,
  inspector,
  statusBar,
  overlays,
  sidebarColumnWidth,
  inspectorColumnWidth,
  hasStatusBar,
  isSidebarDocked,
  isInspectorDocked,
  disableLayoutAnimation = false,
}: WorkspaceFrameProps) {
  const shouldReduceMotion = useReducedMotion()

  /*
   * 左侧侧边栏和右侧属性栏共用一个动画所有者、
   * 一个 transition 和一条动画时间轴。
   */
  const transition =
    disableLayoutAnimation || shouldReduceMotion
      ? { duration: 0 }
      : {
          type: 'tween' as const,
          duration: WORKSPACE_LAYOUT.motion.layoutDurationSeconds,
          ease: WORKSPACE_LAYOUT.motion.layoutEase,
        }

  return (
    <motion.div
      animate={{
        '--workspace-sidebar-column-width': `${sidebarColumnWidth}px`,
        '--workspace-inspector-column-width': `${inspectorColumnWidth}px`,
      }}
      className="workspace-shell relative grid h-dvh w-full min-h-0 overflow-hidden bg-background text-foreground"
      data-canvas-host="workspace"
      data-has-status={hasStatusBar ? 'true' : 'false'}
      data-inspector-docked={isInspectorDocked ? 'true' : 'false'}
      data-sidebar-docked={isSidebarDocked ? 'true' : 'false'}
      initial={false}
      ref={rootRef}
      style={{
        ...WORKSPACE_LAYOUT_STYLE,
        willChange: disableLayoutAnimation ? 'auto' : 'grid-template-columns',
      }}
      transition={transition}
    >
      {chrome}
      {sidebar}
      {canvas}
      {inspector}
      {statusBar}
      {overlays}
    </motion.div>
  )
}
