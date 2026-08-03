/**
 * 转录的草稿。
 *
 * 纯是对外的性质，不是每一步都要复制：写入的那几个入口各取一份可变副本，事件
 * 逐帧写进去，最后封一次版。一次重放因此只分配一次 items，而不是每帧一次 ——
 * 那种写法在一条几千帧的对话上是 O(N²)，代价直接落在打开会话的那一刻。
 *
 * 这里只管「怎么写」：追加、封口、按 id 定位、开一个新的段。帧里那些字是什么
 * 意思归 acp-projection；哪一趟该开草稿、什么时候开段归 timeline-reducer。
 */

import type { RunStatus } from '@poietica/acp'
import type { TimelineItem, TimelineState } from './timeline-contract'

export interface Draft {
  status: RunStatus
  readonly items: TimelineItem[]
  /** id → 下标；没人按 id 找过就还没有。 */
  index: Map<string, number> | null
  lastSeq: number
  runIndex: number
}

export function draftOf(state: TimelineState): Draft {
  return {
    status: state.status,
    items: state.items.slice(),
    index: null,
    lastSeq: state.lastSeq,
    runIndex: state.runIndex,
  }
}

export function freeze(draft: Draft): TimelineState {
  return {
    status: draft.status,
    items: draft.items,
    lastSeq: draft.lastSeq,
    runIndex: draft.runIndex,
  }
}

/** 新的一轮：它自己的帧从一开始编号，所以窗口跟着换。 */
export function openSegment(draft: Draft): void {
  draft.lastSeq = 0
  draft.runIndex += 1
}

/**
 * The identity prefix of the turn currently being written.
 *
 * 回放出来的段号是零或负数（最后一轮为 r0），实时开出来的段号为正。两者不会
 * 相遇：一条对话被读回来之后，接着说的话开的是 r1，而 r1 在任何一次回放里都
 * 不存在。
 */
export function namespace(draft: Draft): string {
  return `r${String(draft.runIndex)}-`
}

/** 追加一条：末尾那段说到这里为止，新的一条排在它后面。 */
export function push(draft: Draft, item: TimelineItem): void {
  sealTail(draft)
  draft.items.push(item)
  draft.index?.set(item.id, draft.items.length - 1)
}

export function sealTail(draft: Draft): void {
  const tail = draft.items.at(-1)

  if (!tail) {
    return
  }

  if (tail.type !== 'agent_text' && tail.type !== 'agent_thought') {
    return
  }

  if (tail.sealed) {
    return
  }

  draft.items[draft.items.length - 1] = { ...tail, sealed: true }
}

/**
 * 按 id 找一条：索引只有在真的要对账时才建，一次草稿至多建一次。
 *
 * 纯文本流从不走这里，所以流式追加不需要为索引付任何代价。
 */
export function positionOf(draft: Draft, id: string): number {
  let index = draft.index

  if (index === null) {
    index = new Map<string, number>()

    for (const [position, item] of draft.items.entries()) {
      index.set(item.id, position)
    }

    draft.index = index
  }

  return index.get(id) ?? -1
}
