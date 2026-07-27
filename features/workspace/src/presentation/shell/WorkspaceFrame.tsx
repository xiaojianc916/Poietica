import { type MotionStyle, motion, useReducedMotion } from 'motion/react'
import type { ReactNode, Ref } from 'react'
import { WORKSPACE_LAYOUT } from './workspace-layout'

type WorkspaceMotionStyle = MotionStyle & Record<`--${string}`, string | number>

const WORKSPACE_LAYOUT_STYLE: WorkspaceMotionStyle = {
  '--workspace-sidebar-nav-icon-center': `${WORKSPACE_LAYOUT.sidebar.navIconCenter}px`,
  '--inspector-width': `${WORKSPACE_LAYOUT.inspector.width}px`,
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
  readonly gridTemplateColumns: string
  readonly gridTemplateRows: string
  readonly sidebarColumnWidth: number
  readonly inspectorColumnWidth: number
  readonly disableLayoutAnimation?: boolean
}

export function WorkspaceFrame({
  rootRef,
  chrome,
  sidebar,
  canvas,
  inspector,
  statusBar,
  overlays,
  gridTemplateColumns,
  gridTemplateRows,
  sidebarColumnWidth,
  inspectorColumnWidth,
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
      initial={false}
      ref={rootRef}
      style={{
        ...WORKSPACE_LAYOUT_STYLE,
        gridTemplateColumns,
        gridTemplateRows,
        willChange: disableLayoutAnimation ? 'auto' : 'grid-template-columns',
      }}
      transition={transition}
    >
      {/* Layout ownership lives here so borders stay single-source and predictable. */}
      {chrome}
      {sidebar}
      {canvas}
      {inspector}
      {statusBar}
      {overlays}
    </motion.div>
  )
}
