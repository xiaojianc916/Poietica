import { describe, expect, it } from 'vitest'

import { readSubAgent } from '../semantics/sub-agent'

/*
 * 子代理派发的判据。
 *
 * 纯函数，不渲染：卡片只是把它的结果画出来。判据落在入参的形状上，所以这里最
 * 要紧的一条是「工具名叫别的也照样认得出来」—— 那正是不写 title === 'Agent'
 * 的理由，它必须被钉住，否则将来有人会图省事把它改回去。
 */

describe('子代理派发', () => {
  it('入参缺席就不是派发', () => {
    expect(readSubAgent(undefined)).toBeNull()
    expect(readSubAgent(null)).toBeNull()
  })

  it('入参不是一个对象就不是派发', () => {
    expect(readSubAgent('Agent')).toBeNull()
    expect(readSubAgent(['general-purpose'])).toBeNull()
    expect(readSubAgent(42)).toBeNull()
  })

  it('子代理种类空着或不是字符串,一律不认', () => {
    expect(readSubAgent({ subagent_type: '   ' })).toBeNull()
    expect(readSubAgent({ subagent_type: 7 })).toBeNull()
    expect(readSubAgent({ prompt: '干活' })).toBeNull()
  })

  it('认的是入参的形状,不是工具名', () => {
    const brief = readSubAgent({ description: '找出超时重试', subagent_type: 'general-purpose' })

    expect(brief?.type).toBe('general-purpose')
    expect(brief?.label).toBe('general-purpose · 找出超时重试')
  })

  it('上游没写描述就取任务书的第一句,并且截断', () => {
    const brief = readSubAgent({
      prompt: `${'很长的一句'.repeat(30)}\n第二段`,
      subagent_type: 'explorer',
    })

    expect(brief?.gist).toHaveLength(81)
    expect(brief?.gist.endsWith('…')).toBe(true)
    expect(brief?.gist).not.toContain('第二段')
  })

  )

  it('描述整段是空白时退回任务书,不留一个空标题', () => {
    const brief = readSubAgent({ description: '  ', prompt: '读一遍日志', subagent_type: 'reader' })

    expect(brief?.label).toBe('reader · 读一遍日志')
  })

  it('两样都没有就只报种类,不拼一个孤零零的分隔符', () => {
    const brief = readSubAgent({ subagent_type: 'reader' })

    expect(brief?.label).toBe('reader')
  })

  it('后台只认真正的 true,字符串 false 也是真值', () => 
    expect(readSubAgent({ run_in_background: true, subagent_type: 'r' })?.isBackground).toBe(true)
    expect(readSubAgent({ run_in_background: 'false', subagent_type: 'r' })?.isBackground).toBe(
      false,
    )
    expect(readSubAgent({ subagent_type: 'r' })?.isBackground).toBe(false))
})
