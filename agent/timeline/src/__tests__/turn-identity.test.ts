import { describe, expect, it } from 'vitest'

import { SAMPLE_RUN_EVENTS } from '../__fixtures__/timeline-fixtures'
import type { TimelineState } from '../timeline-contract'
import { replayRunEvents } from '../timeline-reducer'
import { selectFeedRows, selectTurns } from '../timeline-selectors'

/* poietica:turn-identity@v17 */

/*
 * 轮次的身份是一条契约,不是一个实现细节。
 *
 * 缩略导航是 memo 过的,它整棵跳过与否只取决于 turns 这一个引用。所以"内容没变
 * 时引用也不变"必须有测试守着 —— 否则下一次有人在 buildTurns 里顺手 map 一下,
 * 性能就静默塌回去,而所有功能测试照样全绿。
 */

const LIVE = SAMPLE_RUN_EVENTS.filter((event) => event.kind !== 'run_finished')

describe('turn identity', () => {
  it('从样例会话里读出一轮,标题与预览各就各位', () => {
    const turns = selectTurns(selectFeedRows(replayRunEvents(SAMPLE_RUN_EVENTS)))

    expect(turns).toHaveLength(1)
    expect(turns[0]?.rowIndex).toBe(0)
    expect(turns[0]?.label).toBe('把 README 里的构建命令核对一遍')
    /* 预览取第一条有内容的 agent_text,思考过程不算。 */
    expect(turns[0]?.reply).toBe('构建命令与 scripts 一致。')
  })

  it('只有末尾那一行的角色变了时,轮次连数组带对象一起复用', () => {
    const live = replayRunEvents(LIVE)

    /*
     * 用展开构造下一帧,而不是重放第二遍。
     *
     * 重放会产出一整套全新的条目对象,弱表自然全部落空 —— 那测的是"两段互不相干
     * 的历史",不是"同一段历史的下一帧"。真实情形是 reducer 只换掉它碰过的那一条,
     * 其余条目原样带走,这里就照这个来。
     */
    const done: TimelineState = { ...live, status: 'completed' }

    const liveRows = selectFeedRows(live)
    const doneRows = selectFeedRows(done)

    /* 前提得先成立:两帧的行数组确实不同,且不同就不同在末尾那一行的角色上。 */
    expect(doneRows).not.toBe(liveRows)
    expect(doneRows.at(-1)).not.toBe(liveRows.at(-1))
    expect(liveRows.at(-1)?.isStreamingTail).toBe(true)
    expect(doneRows.at(-1)?.isStreamingTail).toBe(false)

    /* 提问那一行没被碰过,所以它自己也该是同一个对象。 */
    expect(doneRows[0]).toBe(liveRows[0])

    const first = selectTurns(liveRows)
    const second = selectTurns(doneRows)

    expect(first).toHaveLength(1)
    expect(second).toBe(first)
    expect(second[0]).toBe(first[0])
  })

  it('同一个行数组反复读,给的是同一份', () => {
    const rows = selectFeedRows(replayRunEvents(SAMPLE_RUN_EVENTS))

    expect(selectTurns(rows)).toBe(selectTurns(rows))
  })
})
