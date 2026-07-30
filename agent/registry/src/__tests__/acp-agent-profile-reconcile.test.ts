import { describe, expect, it } from 'vitest'
import {
  type AcpAgentProfile,
  builtinAcpAgentProfiles,
  reconcileAcpAgentProfiles,
} from '../acp-agent-profile'

/*
 * agents.json 是内置档案的物化产物，不是第二个来源。
 *
 * 这份测试守的是一个真实发生过的故障：磁盘上那条 kimi 档案是首次启动时写下的拷贝，
 * 之后二进制给档案加了 registryKeyVar，而拷贝永远拿不到它 —— 设置页于是说这个 agent
 * 没有声明该往哪个环境变量注入密钥，密钥一个字也写不进去。
 */

const builtins = builtinAcpAgentProfiles()
const keyed = builtins.find((profile) => profile.registryKeyVar !== undefined)

if (!keyed) {
  throw new Error('没有内置档案声明代填密钥的变量名，这份测试没有可用的装置')
}

/* 用户自带的 agent：不在二进制的名单里，物化不该碰它。 */
const homemade: AcpAgentProfile = {
  id: 'homemade',
  displayName: '自带的 agent',
  command: 'my-agent',
  args: ['acp'],
  cwd: undefined,
  env: {},
  homeVar: undefined,
  registryKeyVar: undefined,
  defaultConfigOptions: {},
}

describe('内置档案的物化', () => {
  it('磁盘为空时给出全部内置档案', () => {
    const result = reconcileAcpAgentProfiles([])

    expect(result.changed).toBe(true)
    expect(result.profiles.map((profile) => profile.id)).toEqual(builtins.map((one) => one.id))
  })

  it('与二进制一致时不报改动', () => {
    const result = reconcileAcpAgentProfiles(builtins)

    expect(result.changed).toBe(false)
    expect(result.profiles).toEqual(builtins)
  })

  it('补回后来才加进档案的注入变量名', () => {
    const stale = { ...keyed, registryKeyVar: undefined }

    const result = reconcileAcpAgentProfiles([stale])

    expect(result.changed).toBe(true)
    expect(result.profiles[0]?.registryKeyVar).toBe(keyed.registryKeyVar)
  })

  it('覆盖被改过的启动命令，保留用户自己那几格', () => {
    const stale = { ...keyed, command: 'stale', cwd: '/work', env: { EXTRA: '1' } }

    const result = reconcileAcpAgentProfiles([stale])
    const profile = result.profiles[0]

    expect(result.changed).toBe(true)
    expect(profile?.command).toBe(keyed.command)
    expect(profile?.cwd).toBe('/work')
    expect(profile?.env).toEqual({ EXTRA: '1' })
  })

  it('原样保留陌生 id 的档案', () => {
    const result = reconcileAcpAgentProfiles([homemade])

    expect(result.profiles[0]).toEqual(homemade)
  })
})
