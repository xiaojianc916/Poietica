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
 * 一轮的帧开始到了。
 *
 * 段可能已经开过：人先说话时开段的是 appendUserMessage —— 那一句话就是这一轮的
 * 开头，它和随后的帧本来就该同号。「这一段还没收过帧」就是「它刚被开出来」，所以
 * 不必另记一个标志位，lastSeq 为零说的就是这件事。
 *
 * 没有经过输入框的那些轮次（重连续接、重试）到这里时，lastSeq 还停在上一轮的窗口
 * 上，于是照常开一段 —— 否则整轮会被上一轮的 seq 判成重复而逐帧丢掉。
 */
export function beginRun(draft: Draft): void {
  if (draft.lastSeq === 0) {
    return
  }

  openSegment(draft)
}

/**
 * The identity prefix of the turn currently being written.
 *
 * 回放出来的段号是零或负数（最后一轮为 r0），接着说下去开出来的段号为正。
 *
 * 段由先到的那一方开：人先说话，段在 appendUserMessage 那一刻就开了；没有经过
 * 输入框的那些轮次（重连续接、重试）由 run_started 开。两边不会各开一次 —— 帧
 * 那侧走 beginRun，它只在这一段已经收过帧时才开新的一段。人说的那句话因此与它
 * 的答复同号，实时与回放对同一条对话给出同一种归属。
 *
 * 本地那两条路径的号源是整条对话的长度，与帧那边按 seq 编的号不是一回事，所以
 * 前缀是 local- 开头的，与协议发的号彻底隔开：共用前缀时，一段只有 prompt、没有
 * 任何产出的日志（断网就是这样）正好让两个号源撞出同一个 id。
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
