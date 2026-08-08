import { describe, expect, it } from 'vitest'

import { decodePluginLedger, encodePluginLedger, type PluginRecord } from './record'

const RECORD: PluginRecord = {
  id: 'demo',
  specifier: 'https://github.com/acme/demo/tree/main',
  trust: 'curated',
  enabled: false,
  installedAt: '2026-01-01T00:00:00.000Z',
  disabledMcpServers: ['files'],
}

describe('decodePluginLedger', () => {
  it('没有文件是首次运行，不是坏账本', () => {
    expect(decodePluginLedger(null)).toEqual({ kind: 'decoded', records: [] })
  })

  it('编码解码往返不丢字段', () => {
    expect(decodePluginLedger(encodePluginLedger([RECORD]))).toEqual({
      kind: 'decoded',
      records: [RECORD],
    })
  })

  it('缺省项按上游语义补齐：装上就是开着，没徽章就是第三方', () => {
    const contents = JSON.stringify({
      version: '1',
      plugins: [{ id: 'demo', specifier: './demo', installedAt: '2026-01-01T00:00:00.000Z' }],
    })

    expect(decodePluginLedger(contents)).toEqual({
      kind: 'decoded',
      records: [
        {
          id: 'demo',
          specifier: './demo',
          trust: 'third-party',
          enabled: true,
          installedAt: '2026-01-01T00:00:00.000Z',
          disabledMcpServers: [],
        },
      ],
    })
  })

  it('读不懂整份拒收，不退化成空账本', () => {
    expect(decodePluginLedger('{').kind).toBe('undecodable')
    expect(decodePluginLedger(JSON.stringify({ version: '99', plugins: [] })).kind).toBe(
      'undecodable',
    )
  })
})
