import type { TimelineItem } from '@poietica/agent-timeline'

/**
 * 这一条有内容可看吗。
 *
 * 一个判据，两个读者：派生用它决定哪一条上屏，reducer 用它回答「这一轮到底
 * 有没有产出」。抄成两份就会有两种「空」—— 屏幕上什么都没有、reducer 却认为
 * 这一轮有产出，那正是一次静默失败的成因。
 */
export function isRenderable(item: TimelineItem): boolean {
  if (item.type === 'agent_text' || item.type === 'agent_thought') {
    return item.text.length > 0
  }

  if (item.type === 'plan') {
    return item.entries.length > 0
  }

  return true
}
