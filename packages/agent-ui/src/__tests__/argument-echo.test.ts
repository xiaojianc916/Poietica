import type { AcpToolCallContent } from '@poietica/acp'
import { describe, expect, it } from 'vitest'

import { toToolCallView, withoutArgumentEcho } from '../domain/tool-call-content'

/*
 * 入参回显。
 *
 * 上游的原话在 events-map.ts：建卡时 content 里就是 stringifyArgs(event.args)，流式
 * 期间逐片替换成累积的片段。这些用例照那个形状造输入 —— 不是照我以为的形状。
 */

const ARGS = { prompt: '把日志读一遍', subagent_type: 'general-purpose' }
const ECHO = JSON.stringify(ARGS)

function said(text: string): readonly AcpToolCallContent[] {
  return [{ type: 'content', content: { type: 'text', text } }]
}

describe('入参回显', () => {
  it('没有入参可比,原样交回而且是同一份投影', () => {
    const view = toToolCallView(said(ECHO))

    expect(withoutArgumentEcho(view, { status: 'in_progress' })).toBe(view)
  })

  it('内容正是入参的字符串化,不当输出画', () => {
    const view = withoutArgumentEcho(toToolCallView(said(ECHO)), {
      rawInput: ARGS,
      status: 'in_progress',
    })

    expect(view.parts).toEqual([])
  })

  it('流到一半的未闭合片段也认得出', () => {
    const view = withoutArgumentEcho(toToolCallView(said(ECHO.slice(0, 20))), {
      rawInput: ARGS,
      status: 'pending',
    })

    expect(view.parts).toEqual([])
  })

  it('调用落定之后不再摘:那时那段文本是真的产出', () => {
    const view = toToolCallView(said(ECHO))

    expect(withoutArgumentEcho(view, { rawInput: ARGS, status: 'completed' })).toBe(view)
    expect(withoutArgumentEcho(view, { rawInput: ARGS, status: 'failed' })).toBe(view)
  })

  it('只摘文本那一格,diff 与它的增删统计都留着', () => {
    const content: readonly AcpToolCallContent[] = [
      { type: 'diff', path: 'a.ts', oldText: '一\n', newText: '一\n二\n' },
      ...said(ECHO),
    ]
    const view = withoutArgumentEcho(toToolCallView(content), {
      rawInput: ARGS,
      status: 'in_progress',
    })

    expect(view.parts).toHaveLength(1)
    expect(view.parts[0]?.type).toBe('diff')
    expect(view.diffStat).toEqual({ added: 1, removed: 0 })
  })

  it('与入参无关的文本一格不动,引用也不换', () => {
    const view = toToolCallView(said('读完了,一共 42 行。'))

    expect(withoutArgumentEcho(view, { rawInput: ARGS, status: 'in_progress' })).toBe(view)
  })
})
