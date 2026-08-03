import type { ThreadRecord } from '@poietica/acp'

/*
 * 侧栏那张列表的形状与顺序。两者都不依赖 store 的任何实例状态。
 */

/**
 * 一行会话在列表里的样子。
 *
 * 名字在投影时就已经定下来了：三个来源在 store 里分出胜负，渲染层拿到的是结论。
 */
export interface ThreadListItem {
  readonly id: string
  readonly title: string
  readonly isPinned: boolean
  readonly updatedAt: string
}

/** 侧栏要的那一片：只有这三样变了，侧栏才需要重画。 */
export interface ThreadsList {
  readonly items: readonly ThreadListItem[]
  readonly isLoading: boolean
  readonly failure: string | null
}

/**
 * 置顶在前，然后按活动时间倒序。
 *
 * 时间是 RFC 3339 且两侧都写 UTC（库用 now()，本地用 toISOString），所以
 * 字典序就是时间序，不需要解析成 Date 再比 —— 那是每次排序为每一行各建两个对象。
 */
export function byRecency(left: ThreadRecord, right: ThreadRecord): number {
  const pinned = left.pinned === true

  if (pinned !== (right.pinned === true)) {
    return pinned ? -1 : 1
  }

  return right.updatedAt.localeCompare(left.updatedAt)
}
