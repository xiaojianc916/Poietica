import type { AcpToolCallContent } from '@poietica/acp'
import { describe, expect, it } from 'vitest'

import { withoutArgumentEcho } from '../acp-projection'

/*
 * 入参回显。
 *
 * 上游的原话在 kimi-code 的 events-map.ts：建卡时 content 里就是
 * stringifyArgs(event.args)，流式期间逐片替换成累积的片段。这些用例照那个形状造输入
 * —— 不是照我以为的形状。
 */

const ARGS = { prompt: '把日志读一遍', subagent_type: 'general-purpose' }
const ECHO = JSON.stringify(ARGS)

function said(text: string): readonly AcpToolCallContent[] {
  return [{ type: 'content', content: { type: 'text', text } }]
}

describe('入参回显', () => {
  it('没有入参可比,原样交回而且是同一个数组', () => {
    const content = said(ECHO)

    expect(withoutArgumentEcho(content, undefined, 'in_progress')).toBe(content)
  })

  it('内容正是入参的字符串化,不当产出留下', () => {
    expect(withoutArgumentEcho(said(ECHO), ARGS, 'in_progress')).toEqual([])
  })

  it('流到一半的未闭合片段也认得出', () => {
    expect(withoutArgumentEcho(said(ECHO.slice(0, 20)), ARGS, 'pending')).toEqual([])
  })

  it('终态之后不再摘:那时那段文本是真的产出', () => {
    const content = said(ECHO)

    expect(withoutArgumentEcho(content, ARGS, 'completed')).toBe(content)
    expect(withoutArgumentEcho(content, ARGS, 'failed')).toBe(content)
  })

  it('只摘文本那一格,diff 留着', () => {
    const content: readonly AcpToolCallContent[] = [
      { type: 'diff', path: 'a.ts', oldText: '一\n', newText: '一\n二\n' },
      ...said(ECHO),
    ]
    const kept = withoutArgumentEcho(content, ARGS, 'in_progress')

    expect(kept).toHaveLength(1)
    expect(kept[0]?.type).toBe('diff')
  })

  it('与入参无关的文本一格不动,引用也不换', () => {
    const content = said('读完了,一共 42 行。')

    expect(withoutArgumentEcho(content, ARGS, 'in_progress')).toBe(content)
  })
})
