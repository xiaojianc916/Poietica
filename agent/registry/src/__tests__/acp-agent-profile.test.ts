import { describe, expect, it } from 'vitest'
import {
  acpAgentCommandLine,
  builtinAcpAgentProfileSet,
  parseAcpAgentCommandLine,
  parseAcpAgentProfile,
  parseAcpAgentProfileSet,
} from '../acp-agent-profile'

const valid = {
  id: 'kimi',
  displayName: 'Kimi Code',
  command: 'kimi',
  args: ['acp'],
  env: { NO_COLOR: '1' },
  credentialBinding: {
    providerId: 'moonshot',
    apiKeyEnv: 'ANTHROPIC_AUTH_TOKEN',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
  },
  defaultConfigOptions: { model: 'kimi-k2-turbo-preview', brave_mode: false },
}

describe('parseAcpAgentProfile', () => {
  it('接受一个完整档案', () => {
    const result = parseAcpAgentProfile(valid)

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.profile.args).toEqual(['acp'])
      expect(result.profile.defaultConfigOptions.brave_mode).toBe(false)
    }
  })

  it('拒绝带 shell 元字符的命令', () => {
    expect(parseAcpAgentProfile({ ...valid, command: 'kimi; rm -rf /' }).ok).toBe(false)
  })

  it('拒绝不合法的环境变量名', () => {
    expect(parseAcpAgentProfile({ ...valid, env: { 'not-an-env': '1' } }).ok).toBe(false)
  })

  it('拒绝非字符串非布尔的会话配置值', () => {
    expect(parseAcpAgentProfile({ ...valid, defaultConfigOptions: { model: 3 } }).ok).toBe(false)
  })
})

describe('parseAcpAgentProfileSet', () => {
  it('丢弃坏条目但保留好条目', () => {
    const result = parseAcpAgentProfileSet({
      profiles: [valid, { id: 'BROKEN' }],
      defaultProfileId: 'kimi',
    })

    expect(result.value.profiles).toHaveLength(1)
    expect(result.issues).toHaveLength(1)
  })

  it('默认 agent 指向不存在的档案时回落到第一个', () => {
    const result = parseAcpAgentProfileSet({ profiles: [valid], defaultProfileId: 'ghost' })

    expect(result.value.defaultProfileId).toBe('kimi')
    expect(result.issues).toHaveLength(1)
  })

  it('完全无法解析时回退到内置档案', () => {
    const result = parseAcpAgentProfileSet(null)

    expect(result.value.profiles).toEqual(builtinAcpAgentProfileSet().profiles)
  })
})

describe('命令行往返', () => {
  it('拆分与拼回保持一致', () => {
    const parsed = parseAcpAgentCommandLine('  kimi   acp  ')

    expect(parsed).toEqual({ command: 'kimi', args: ['acp'] })
    expect(acpAgentCommandLine({ ...valid, ...parsed })).toBe('kimi acp')
  })
})

describe('builtinAcpAgentProfileSet', () => {
  it('把内置命令行拆成可以直接 spawn 的形式', () => {
    const set = builtinAcpAgentProfileSet()

    expect(set.profiles.length).toBeGreaterThan(0)

    for (const profile of set.profiles) {
      expect(profile.command).not.toContain(' ')
    }

    expect(set.profiles.some((profile) => profile.id === set.defaultProfileId)).toBe(true)
  })
})
