import { describe, expect, it } from 'vitest'
import {
  type AcpAgentProfile,
  builtinAcpAgentProfiles,
  reconcileAcpAgentProfiles,
} from '../acp-agent-profile'

/*
 * agents.json 是名单的一份物化，不是第二个来源。
 *
 * 物化现在只做一件事：让磁盘上的那几条与封闭名单对齐。此前它还要逐格比对七个
 * 启动字段，那是因为那七格既在磁盘上又在二进制里 —— 现在它们只在二进制里，那
 * 一整类「拷贝停在旧版本」的故障因此在结构上不存在了。
 */

const builtins = builtinAcpAgentProfiles()
const first = builtins[0]

if (!first) {
  throw new Error('名单里一家 agent 都没有，这份测试没有可用的装置')
}

/* 手写进配置文件的、不在名单里的一家。 */
const homemade: AcpAgentProfile = {
  id: 'homemade',
  cwd: undefined,
  env: {},
  defaultConfigOptions: {},
}

describe('内置档案的物化', () => {
  it('磁盘为空时给出全部内置档案', () => {
    const result = reconcileAcpAgentProfiles([])

    expect(result.changed).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.profiles.map((profile) => profile.id)).toEqual(builtins.map((one) => one.id))
  })

  it('与名单一致时不报改动', () => {
    const result = reconcileAcpAgentProfiles(builtins)

    expect(result.changed).toBe(false)
    expect(result.issues).toEqual([])
    expect(result.profiles).toEqual(builtins)
  })

  it('用户自己那三格原样保留', () => {
    const mine = { ...first, cwd: '/work', env: { EXTRA: '1' }, defaultConfigOptions: { a: true } }

    const result = reconcileAcpAgentProfiles([mine])
    const profile = result.profiles[0]

    expect(result.changed).toBe(false)
    expect(profile?.cwd).toBe('/work')
    expect(profile?.env).toEqual({ EXTRA: '1' })
    expect(profile?.defaultConfigOptions).toEqual({ a: true })
  })

  /*
   * 名单是封闭的，所以一条不在名单里的档案是用不了的：原生侧按 id 查不到该起哪个
   * 程序。留着它只会让下拉里多一家选中就失败的 agent。丢掉必须说出来。
   */
  it('移除不在名单里的档案，并说明原因', () => {
    const result = reconcileAcpAgentProfiles([homemade])

    expect(result.changed).toBe(true)
    expect(result.profiles.some((profile) => profile.id === 'homemade')).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toContain('homemade')
  })

  it('移除之后名单里的那几家仍然补齐', () => {
    const result = reconcileAcpAgentProfiles([homemade])

    expect(result.profiles.map((profile) => profile.id)).toEqual(builtins.map((one) => one.id))
  })
})
