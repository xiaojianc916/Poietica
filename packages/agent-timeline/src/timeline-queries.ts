import { isRenderable } from './renderable'
import type { PermissionItem, TimelineItem, TimelineState } from './timeline-contract'

/**
 * 转录的即时问句。
 *
 * 这几个选择器不缓存，也不该缓存：答案要么就是状态里的一个字段，要么反着走到
 * 本轮开头就收手 —— 代价是一轮的长度，不是整条对话的长度。给它们建表，建表
 * 本身比重算贵。
 *
 * 它们此前与两条增量管线同住一屋，于是 selectFeedRows 里出现了一份手抄的
 * status === 'running' || status === 'awaiting_permission' —— 同一个文件里已经
 * 有一个导出的选择器在回答这个问题，却没有人调用它。现在它是行投影的输入。
 */

/**
 * The question the run is currently blocked on, if any.
 *
 * At most one: the agent waits for an answer before asking anything else. 那条
 * 不变式此前只写在注释里，实现却是一次正向 find —— 于是为了找一个恒在本轮末尾
 * 的东西，每次都要走完整条已答的历史。反着走，并在本轮开头收手：走到人说的上
 * 一句话，就说明这一轮没有在等谁。
 */
export function selectPendingPermission(state: TimelineState): PermissionItem | undefined {
  const items = state.items

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]

    if (item === undefined) {
      continue
    }

    if (item.type === 'user_message') {
      return undefined
    }

    if (item.type === 'permission' && item.resolution === undefined) {
      return item
    }
  }

  return undefined
}

export function selectIsBusy(state: TimelineState): boolean {
  return state.status === 'running' || state.status === 'awaiting_permission'
}

/**
 * 一轮已经问出口，第一帧还没到。
 *
 * 转录里没有条目能表示这段空档，所以它由派生回答，交给等待指示器。
 *
 * 这里此前还回答另一件事：一轮结束却没有产出任何条目时，footer 换成一句凭
 * status 枚举编出来的说明。那句措辞已经删掉 —— 它的输入里根本没有「发生了
 * 什么」。但它顺带在报的那个事实（这一轮空转了）不该跟着一起删：现在由
 * reducer 的 silentTurn 用协议原词记成一条 error，与别的报错走同一条横线。
 */
export function selectIsWaiting(state: TimelineState): boolean {
  if (state.status !== 'running' && state.status !== 'awaiting_permission') {
    return false
  }

  return lastRenderable(state.items)?.type === 'user_message'
}

function lastRenderable(items: readonly TimelineItem[]): TimelineItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]

    if (item !== undefined && isRenderable(item)) {
      return item
    }
  }

  return undefined
}
