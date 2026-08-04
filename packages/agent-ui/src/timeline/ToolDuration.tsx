import type { ToolCallTimelineItem } from '@poietica/agent-timeline'
import { formatDuration, nextTickOf } from '../domain/duration'
import { useHorizon, useNow } from '../threads/clock'

/*
 * 一次调用跑了多久。
 *
 * 子代理是这一格存在的理由：上游不回传子代理的过程，所以那张卡片从头到尾没有
 * 内容，纺锤转着，几分钟里一个像素不变 —— 看上去和卡死没有区别。耗时是这种
 * 场景下唯一的活体信号。
 *
 * 跑着的和落定的分成两个组件，不是一个组件里两条分支：hooks 不许有条件调用，
 * 而落定的卡片绝不能订阅时钟 —— 一屏几十张历史卡片，那会让整条转录每秒重画
 * 一次，而它们的文案永远不变。按 isRunning 换组件，订阅随之挂载与卸载。
 */

function Label({ text }: { readonly text: string | null }) {
  return text === null ? null : <span className="timeline-tool__duration">{text}</span>
}

function Running({ startedAt }: { readonly startedAt: number }) {
  const now = useNow()

  /* 报出自己下一次改口的时刻；时钟睡到那一刻为止，不轮询。 */
  useHorizon(nextTickOf(startedAt, now))

  return <Label text={formatDuration(now - startedAt)} />
}

export function ToolDuration({
  isRunning,
  item,
}: {
  readonly isRunning: boolean
  readonly item: ToolCallTimelineItem
}) {
  if (isRunning) {
    return <Running startedAt={item.startedAt} />
  }

  /*
   * endedAt 缺席就不画。
   *
   * 那正是「异常结束」的那种卡片：轮次停了，而这次调用从未收到终态，我们并不
   * 知道它什么时候停的。编一个数出来比不画更糟 —— 卡片对这种状态的既有态度是
   * 安静地待着，既不转也不报错，这里保持一致。
   */
  return item.endedAt === undefined ? null : (
    <Label text={formatDuration(item.endedAt - item.startedAt)} />
  )
}
