import { describe, expect, it } from 'vitest'
import { decodePluginLedger, encodePluginLedger, type PluginRecord } from './record'

const RECORD: PluginRecord = {
  id: 'kimi-datasource',
  source: {
    kind: 'github',
    owner: 'MoonshotAI',
    repo: 'kimi-code',
    ref: { kind: 'tree', ref: 'main' },
    subdirectory: 'plugins/official/kimi-datasource',
  },
  trust: 'kimi-official',
  enabled: true,
  installedAt: '2026-01-01T00:00:00.000Z',
  disabledMcpServers: [],
}

describe('decodePluginLedger', () => {
  it('没有文件是空账本，那是首次运行', () => {
    expect(decodePluginLedger(null)).toEqual({ kind: 'decoded', records: [] })
  })

  it('读不懂的账本整份拒收，不塌成空账本', () => {
    expect(decodePluginLedger('{ 半个').kind).toBe('undecodable')
    expect(decodePluginLedger('{"version":"9","plugins":[]}').kind).toBe('undecodable')
  })

  it('来源结构原样往返，子目录不丢', () => {
    const decoded = decodePluginLedger(encodePluginLedger([RECORD]))

    expect(decoded).toEqual({ kind: 'decoded', records: [RECORD] })
  })

  it('缺省字段有确定的落点', () => {
    const decoded = decodePluginLedger(
      JSON.stringify({
        version: '1',
        plugins: [{ id: 'x', source: { kind: 'directory', path: '/x' }, installedAt: 'now' }],
      }),
    )

    if (decoded.kind !== 'decoded') {
      throw new Error('这份账本是合法的')
    }

    expect(decoded.records[0]?.trust).toBe('third-party')
    expect(decoded.records[0]?.enabled).toBe(true)
    expect(decoded.records[0]?.disabledMcpServers).toEqual([])
  })
})
