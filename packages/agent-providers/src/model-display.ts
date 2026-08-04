import { builtinAgentProviderById } from './provider-presets'
import type { AgentModelState } from './provider-state'

/*
 * 别名与显示名的换算。
 *
 * 从 provider-presets.ts（原 builtin-catalog.ts）搬出来的：那个模块是一张内置常量表，
 * 而这两个函数吃的是 provider list 的运行时快照（AgentModelState）—— 表反向依赖快照，
 * 方向是错的。搬出之后依赖只剩一条单向的：显示 → 内置表 → ∅。
 *
 * 这里只读，不写。它不属于任何一家 agent：剥前缀的判据来自命令行约定，补显示名的判据
 * 来自我们自己的内置表，两条都与「哪一家 CLI」无关。
 */

/*
 * 剥掉别名的 provider/ 前缀。--default-model 只认裸模型 id：对方的校验名单是
 * catalogProviderModels，里面的 id 没有前缀。别名取不到前缀时原样用。
 */
function bareModelId(alias: string, providerId: string): string {
  const prefix = `${providerId}/`

  return alias.startsWith(prefix) ? alias.slice(prefix.length) : alias
}

/*
 * 别名剥掉 provider/ 前缀后的裸模型 id。
 *
 * --default-model 只认它：对方的校验名单是 catalogProviderModels 解析出来的模型
 * （handleCatalogAdd 里 models.some((m) => m.id === opts.defaultModel)），那里面的 id
 * 没有前缀；写成功之后它自己再拼回去（Default model set to ${providerId}/${...}）。
 *
 * 导出而不是让调用方各剥各的：这是对方命令行的约定，抄第二遍就会有第二种剥法。
 */
export function agentBareModelId(alias: string, providerId: string): string {
  return bareModelId(alias, providerId)
}

/*
 * 一条模型给人看的名字。显示层的事：别名一个字符都不动 —— 它是数据键。
 *
 * 规则只有一条：agent 报的名字与别名不同，以 agent 为准；相同（等于没起名）就查
 * 内置表补全；都不沾边才原样显示别名。写入（importDocument 的 name）与展示
 * （模型行）共用这一条，两处不会长出两种叫法。
 */
export function agentModelDisplayName(model: AgentModelState): string {
  if (model.displayName !== model.alias) {
    return model.displayName
  }

  if (model.providerId === undefined) {
    return model.alias
  }

  const bare = bareModelId(model.alias, model.providerId)

  return (
    builtinAgentProviderById(model.providerId)?.models.find((one) => one.id === bare)
      ?.displayName ?? model.alias
  )
}
