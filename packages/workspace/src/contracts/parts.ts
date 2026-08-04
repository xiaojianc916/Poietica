import type { ReactNode } from 'react'

/**
 * 工作台的停靠位。
 *
 * 位置是有限且由布局决定的，因此是一个封闭联合而不是任意字符串键：
 * 新增一个位置必须同时给出它在栅格里的坐标，类型会强制这件事被想到。
 */
export type WorkspacePartId = 'chrome' | 'sidebar' | 'main' | 'overlay'

export interface WorkspacePart {
  readonly content: ReactNode
  /**
   * 无障碍名称。
   *
   * 只有在这个 Part 不是标签面板时才需要（例如设置界面接管主区域）；
   * 工作台态由标签条通过 aria-labelledby 关联，给了名字反而是两份。
   */
  readonly label?: string | undefined
}

/**
 * Part 表。
 *
 * chrome / sidebar / main 是工作台的骨架，必须有；overlay 可空。
 * 此前 sidebarOverride、sidebarFooterSlot、assistantOverlay 三个插槽表达的
 * 都是「往某个位置放东西」，现在由这张表统一表达，Shell 不再逐个透传。
 */
export type WorkspaceParts = {
  readonly [K in Exclude<WorkspacePartId, 'overlay'>]: WorkspacePart
} & {
  readonly overlay?: WorkspacePart | undefined
}
