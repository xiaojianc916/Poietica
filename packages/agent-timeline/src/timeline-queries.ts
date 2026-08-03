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

/** 这个问题只需要转录的两格，所以只收这两格。草稿和已封版的状态都喂得进来。 */
export interface PermissionScope {
  readonly items: readonly TimelineItem[]
  readonly runIndex: number
}

/**
 * 本段里最早那个还没被答复的请求。
 *
 * 此前这里写着「At most one: the agent waits for an answer before asking anything
 * else」——那条不变式的成立条件不是协议，是本客户端曾经在权限处理器里就地 await：
 * 派发被堵住，agent 的第二个请求根本进不来。处理器改成 connection.spawn 之后
 *（ADR 0001），堵塞没有了，一轮里同时挂着几个请求就是常态 —— Kimi 的 Agent 工具
 * 并行派几个子代理，每一个都要审批。原生侧的桌子本来就是复数的（desk.rs 里是一张
 * HashMap），只有这里是单数的。
 *
 * 于是判据从「最后一个」改成「最早一个」。仍然反向走，因为要在段边界收手；但交出的
 * 必须是最早那一个 —— 交出最后一个，先问的那几个永远轮不到有人点按钮，它们的
 * oneshot 等不到 answer()，卡片停在 in_progress，这一轮再也结束不了。
 *
 * 一次只交一个，不是一次交一叠：并行的请求彼此独立，一个个答与一叠一起答在协议上
 * 没有分别，而一个个答不需要面板改成队列。答掉一个，下一个顶上来。
 *
 * 名字不再带 select 前缀：投影层在写入路径上也读它（判断「还有没有人在等」），而
 * 那里不是在选渲染的东西。一个判据两个读者，抄成两份就会有两种「还在等」。
 *
 * 边界读的是条目自己的段号。此前读的是「撞见一条用户消息」，而那会漏掉一个能把整轮
 * 卡死的情形：agent 停在一个还没答复的请求上，人没点按钮，转头在输入框里又说了一句
 * —— 那句话排在请求后面，反向扫第一个就撞上它，面板当场消失，而原生侧还在等这个
 * 答复，界面上再没有任何入口。那句话没有开新的一段（开段的是 run_started），所以它
 * 与那个请求同号，扫描照常走过去。
 */
export function pendingPermission(scope: PermissionScope): PermissionItem | undefined {
  const items = scope.items
  let asked: PermissionItem | undefined

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]

    if (item === undefined) {
      continue
    }

    if (item.turn !== scope.runIndex) {
      return asked
    }

    if (item.type === 'permission' && item.resolution === undefined) {
      asked = item
    }
  }

  return asked
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
