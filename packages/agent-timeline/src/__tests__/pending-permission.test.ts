import { describe, expect, it } from 'vitest'
import type { PermissionItem, TimelineItem } from '../timeline-contract'
import { pendingPermission } from '../timeline-queries'

/*
 * 并行子代理会让一轮里同时挂着几个请求（ADR 0002）。
 *
 * 交出最晚那一个，先问的几个就永远等不到按钮 —— 原生侧的 oneshot 收不到答复,
 * 卡片停在 in_progress，这一轮再也结束不了。所以顺序本身就是不变式。
 */

function asked(requestId: string, turn: number, resolved: boolean): PermissionItem {
  return {
    type: 'permission',
    id: `permission-${requestId}`,
    turn,
    at: 0,
    requestId,
    title: requestId,
    options: [],
    ...(resolved
      ? { resolution: { optionId: 1, outcome: 2 } as PermissionItem['resolution'] }
      : {}),
  }
}

describe('pendingPermission', () => {
  it('交出本段最早那个还没答复的请求', () => {
    const items: readonly TimelineItem[] = [
      asked('a', 1, false),
      asked('b', 1, false),
      asked('c', 1, false),
    ]

    expect(pendingPermission({ items, runIndex: 1 })?.requestId).toBe('a')
  })

  it('答掉一个，下一个顶上来', () => {
    const items: readonly TimelineItem[] = [
      asked('a', 1, true),
      asked('b', 1, false),
      asked('c', 1, false),
    ]

    expect(pendingPermission({ items, runIndex: 1 })?.requestId).toBe('b')
  })

  it('不越过段边界', () => {
    const items: readonly TimelineItem[] = [asked('old', 0, false), asked('now', 1, false)]

    expect(pendingPermission({ items, runIndex: 1 })?.requestId).toBe('now')
  })

  it('全部答完就没有了', () => {
    const items: readonly TimelineItem[] = [asked('a', 1, true), asked('b', 1, true)]

    expect(pendingPermission({ items, runIndex: 1 })).toBeUndefined()
  })
})
