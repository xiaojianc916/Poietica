import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFERENCE,
  decodePluginPreferences,
  encodePluginPreferences,
  type PluginPreference,
} from './preferences'

const PREFERENCE: PluginPreference = {
  enabled: false,
  disabledMcpServers: ['data'],
  source: {
    kind: 'github',
    owner: 'MoonshotAI',
    repo: 'kimi-code',
    ref: { kind: 'tree', ref: 'main' },
    subdirectory: 'plugins/official/kimi-datasource',
  },
  trust: 'kimi-official',
  installedAt: '2026-01-01T00:00:00.000Z',
}

describe('decodePluginPreferences', () => {
  it('没有文件就是没有偏好，那是首次运行', () => {
    expect(decodePluginPreferences(null).size).toBe(0)
  })

  it('读不懂只丢偏好，不代表什么都没装', () => {
    expect(decodePluginPreferences('{ 半个').size).toBe(0)
    expect(decodePluginPreferences('{"version":"9","plugins":{}}').size).toBe(0)
    expect(decodePluginPreferences('{"plugins":{"a":{}}}').size).toBe(0)
  })

  it('一条坏记录只丢它自己，同一份里其余照常读出', () => {
    const decoded = decodePluginPreferences(
      JSON.stringify({
        version: '1',
        plugins: { good: { enabled: false }, bad: { source: { kind: 'nowhere' } } },
      }),
    )

    expect([...decoded.keys()]).toEqual(['good'])
    expect(decoded.get('good')?.enabled).toBe(false)
  })

  it('结构原样往返，子目录不丢', () => {
    const decoded = decodePluginPreferences(
      encodePluginPreferences(new Map([['kimi-datasource', PREFERENCE]])),
    )

    expect(decoded.get('kimi-datasource')).toEqual(PREFERENCE)
  })

  it('缺省字段落在默认档上', () => {
    const decoded = decodePluginPreferences('{"version":"1","plugins":{"x":{}}}')

    expect(decoded.get('x')).toEqual(DEFAULT_PREFERENCE)
  })
})
