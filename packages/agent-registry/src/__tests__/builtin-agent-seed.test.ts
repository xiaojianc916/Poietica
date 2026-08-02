import { describe, expect, it } from 'vitest'
import { builtinAcpAgentProfileSet, parseAcpAgentProfile } from '../acp-agent-profile'
import { acpAgentById } from '../acp-agents'

/*
 * 内置档案不再只是一个内存里的回退值：首次启动时它会被原样写进 agents.json。
 *
 * 所以它必须能过自己那道校验。一条过不了 parseAcpAgentProfile 的内置档案，会
 * 在落盘之后每次读回来都被丢掉，界面表现为「配置好了，模型列表却是空的」。
 *
 * 「要起哪个程序」不再问这份档案 —— 那件事从磁盘上搬走了，问名单。
 */
describe('内置 agent 档案', () => {
  it('至少有一条，且每条都能过自己的校验', () => {
    const set = builtinAcpAgentProfileSet()

    expect(set.profiles.length).toBeGreaterThan(0)

    for (const profile of set.profiles) {
      expect(parseAcpAgentProfile(profile).ok, profile.id).toBe(true)
    }
  })

  it('默认档案指向名单里的一条', () => {
    const set = builtinAcpAgentProfileSet()

    expect(set.profiles.some((profile) => profile.id === set.defaultProfileId)).toBe(true)
  })

  it('每条都能在名单里查到要起哪个程序', () => {
    for (const profile of builtinAcpAgentProfileSet().profiles) {
      expect(acpAgentById(profile.id)?.command.length ?? 0, profile.id).toBeGreaterThan(0)
    }
  })

  /* 档案里不许再出现启动身份的任何一格，否则它就又有了第二个产地。 */
  it('档案里只有用户自己的那几格', () => {
    for (const profile of builtinAcpAgentProfileSet().profiles) {
      expect(Object.keys(profile).sort(), profile.id).toEqual([
        'cwd',
        'defaultConfigOptions',
        'env',
        'id',
      ])
    }
  })
})
