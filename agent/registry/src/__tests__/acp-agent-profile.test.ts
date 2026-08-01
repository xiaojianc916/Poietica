import { describe, expect, it } from 'vitest'
import {
  acpAgentLaunch,
  builtinAcpAgentProfileSet,
  parseAcpAgentProfile,
  parseAcpAgentProfileSet,
} from '../acp-agent-profile'

const valid = {
  id: 'kimi',
  displayName: 'Kimi Code',
  command: 'kimi',
  args: ['acp'],
  env: { NO_COLOR: '1' },
  defaultConfigOptions: { model: 'kimi-k2-turbo-preview', brave_mode: false },
}

describe('parseAcpAgentProfile', () => {
  it('接受一个完整档案', () => {
    const result = parseAcpAgentProfile(valid)

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.profile.args).toEqual(['acp'])
      expect(result.profile.defaultConfigOptions['brave_mode']).toBe(false)
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
    expect(result.fallback).toBe(true)
  })

  /*
   * 每一台新电脑的第一次启动。磁盘上一条都没有不是配置出了问题，所以一条 issue
   * 都不该有 —— 但 fallback 必须为真，调用方据此把内置档案物化到 agents.json，
   * 否则原生侧按 agentId 去查永远查不到。
   */
  it('磁盘为空时回退且不报问题，但要求物化', () => {
    const result = parseAcpAgentProfileSet({ profiles: [], defaultProfileId: '' })

    expect(result.value.profiles).toEqual(builtinAcpAgentProfileSet().profiles)
    expect(result.issues).toEqual([])
    expect(result.fallback).toBe(true)
  })

  it('档案都在但全都用不了时，照实报问题', () => {
    const result = parseAcpAgentProfileSet({ profiles: [{ id: 'BROKEN' }] })

    expect(result.fallback).toBe(true)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('磁盘上有可用档案时不要求物化', () => {
    const result = parseAcpAgentProfileSet({ profiles: [valid], defaultProfileId: 'kimi' })

    expect(result.fallback).toBe(false)
  })
})

describe('acpAgentLaunch', () => {
  it('把档案翻成 agentId 加 program 加 args', () => {
    expect(acpAgentLaunch(valid)).toEqual({
      agentId: 'kimi',
      program: 'kimi',
      args: ['acp'],
    })
  })

  /*
   * 回归护栏：参数必须一直是数组，永远不能退回一行字符串。这一条正是旧的
   * 「命令行往返」测试测不出来的东西 —— 它用的是 kimi acp，一个既没有空格
   * 也没有反斜杠的例子，所以那趟往返看起来是无损的。
   */
  it('带空格的绝对路径与反斜杠原样保留', () => {
    const launch = acpAgentLaunch({
      id: 'kimi',
      command: 'C:\\Program Files\\kimi\\kimi.exe',
      args: ['acp', '--cwd', 'C:\\my notes'],
    })

    expect(launch.program).toBe('C:\\Program Files\\kimi\\kimi.exe')
    expect(launch.args).toEqual(['acp', '--cwd', 'C:\\my notes'])
  })
})

describe('builtinAcpAgentProfileSet', () => {
  it('内置档案本来就是可以直接 spawn 的形式', () => {
    const set = builtinAcpAgentProfileSet()

    expect(set.profiles.length).toBeGreaterThan(0)

    for (const profile of set.profiles) {
      expect(profile.command).not.toContain(' ')
    }

    expect(set.profiles.some((profile) => profile.id === set.defaultProfileId)).toBe(true)
  })
})
