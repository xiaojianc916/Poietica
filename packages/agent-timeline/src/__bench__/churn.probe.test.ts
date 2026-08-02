import { applyRunEvents, replayThreadEvents, selectFeedRows } from '@poietica/agent-timeline'
import { expect, test } from 'vitest'
import { conversationOf, tickOf } from './workload'

/** 一拍最多允许重建几行：正在生长的那一条，仅此一条。 */
const ALLOWED = 1

for (const items of [200, 2_000, 10_000] as const) {
  test(`流式一拍只重建尾行（items=${String(items)}）`, () => {
    const settled = replayThreadEvents(conversationOf(Math.ceil(items / 3), 8).events)

    /* 先开一条消息并且不封口 —— 尾行必须是活的，否则测的是另一回事。 */
    const live = applyRunEvents(settled, tickOf(settled.lastSeq + 1, 16))
    const before = selectFeedRows(live)
    const after = selectFeedRows(applyRunEvents(live, tickOf(live.lastSeq + 1, 16)))

    let rebuilt = 0

    /* 按较长者遍历：新增的行也算重建，上一版正是漏在这里。 */
    for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
      if (before[index] !== after[index]) {
        rebuilt += 1
      }
    }

    console.log(
      `items=${String(items)}  rows=${String(before.length)}→${String(after.length)}  rebuilt=${String(rebuilt)}`,
    )

    expect(rebuilt).toBe(ALLOWED)
  })
}
