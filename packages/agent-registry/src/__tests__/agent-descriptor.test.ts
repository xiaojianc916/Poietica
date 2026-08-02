import { describe, expect, it } from 'vitest'
import { kimiCode } from '../agents/kimi'

/*
 * 档案里「怎么问这一家的模型清单」那两格。
 *
 * 它们此前钉在 provider 解析的测试里，而那份测试随解析一起搬去了
 * @poietica/agent-providers —— 那个包不认识任何一家 agent。护栏留在这边：
 * 声明一家 agent 长什么样，是这个包的事。
 */
describe('kimi 的接入档案', () => {
  /*
   * 形状必须是分好的数组（不是一行待切的命令行），第一项必须是子命令名 ——
   * 原生侧的白名单只看 args[0]。第二条拦的正是「把可执行文件与子命令搞混」那次。
   */
  it('provider list 是完整的子命令序列', () => {
    expect(kimiCode.providerListArgs).toEqual(['provider', 'list', '--json'])
    expect(kimiCode.providerListArgs[0]).toBe('provider')
  })

  /*
   * 解析层用字面量认这个 id（provider-state.test.ts 里的 SYNTHETIC），因为它
   * 不认识任何一家 agent。两边对不上时，这一条先响。
   */
  it('环境变量合成条目的 id 就是解析层认的那一个', () => {
    expect(kimiCode.syntheticProviderId).toBe('__kimi_env__')
  })
})
