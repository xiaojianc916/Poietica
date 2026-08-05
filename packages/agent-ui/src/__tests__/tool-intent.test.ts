import { describe, expect, it } from 'vitest'

import { readToolIntent } from '../semantics/tool-intent'

/*
 * 意图的读法。
 *
 * 形状照 kimi-code 的 tool/toolInputDisplay.ts 抄 —— command / file_io / search /
 * url_fetch 那几种。键名是方言且未经逐字验证，所以「取不到就交回 null」这一条
 * 必须被钉住：它是猜错时的兜底。
 */

const NOWHERE = { locations: [] } as const

describe('工具调用的意图', () => {
  it('命令就是意图', () => {
    const intent = readToolIntent({ ...NOWHERE, rawInput: { command: 'pnpm typecheck' } })

    expect(intent?.text).toBe('pnpm typecheck')
  })

  it('只取第一行:多行命令在一行里画不下', () => {
    const intent = readToolIntent({ ...NOWHERE, rawInput: { command: 'cd packages\nls -la' } })

    expect(intent?.text).toBe('cd packages')
    expect(intent?.full).toBe('cd packages\nls -la')
  })

  it('太长的截断,全文留给悬浮提示', () => {
    const long = 'a'.repeat(400)
    const intent = readToolIntent({ ...NOWHERE, rawInput: { command: long } })

    expect(intent?.text.endsWith('…')).toBe(true)
    expect(intent?.text.length).toBe(161)
    expect(intent?.full).toBe(long)
  })

  it('按键名的可靠度排序,命令压过路径', () => {
    const intent = readToolIntent({
      ...NOWHERE,
      rawInput: { command: 'rg todo', file_path: 'src/app.ts' },
    })

    expect(intent?.text).toBe('rg todo')
  })

  it('入参里没有,就退回协议原生的 locations', () => {
    const intent = readToolIntent({
      locations: [{ line: 42, path: 'src/app.ts' }],
      rawInput: { unknown_key: 'x' },
    })

    expect(intent?.text).toBe('src/app.ts:42')
  })

  it('多处就报个数,剩下的抽屉里已经列过', () => {
    const intent = readToolIntent({
      locations: [{ path: 'a.ts' }, { path: 'b.ts' }],
      rawInput: {},
    })

    expect(intent?.text).toBe('a.ts 等 2 处')
  })

  it('一个键都对不上就说不出来,标题栏退回只有工具名', () => {
    expect(readToolIntent({ ...NOWHERE, rawInput: { verbose: true } })).toBeNull()
    expect(readToolIntent({ ...NOWHERE, rawInput: undefined })).toBeNull()
    expect(readToolIntent({ ...NOWHERE, rawInput: 'not an object' })).toBeNull()
  })

  it('空串和纯空白不算意图', () => {
    expect(readToolIntent({ ...NOWHERE, rawInput: { command: '   ' } })).toBeNull()
  })
})
