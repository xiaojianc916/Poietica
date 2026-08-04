import {
  agentProviderCatalogDocument,
  agentProviderDefaultModelId,
  agentProviderImportDocument,
  builtinProviderDefaultModelId,
} from './agents/kimi/catalog'
import type { AgentProviderPreset } from './builtin-catalog'
import type { AgentProviderState } from './provider-state'

/*
 * 「怎么把 provider 目录写进这一家 agent」的缝。
 *
 * 每一家 agent 的目录命令都是它自己的契约：子命令名、文档形状、默认模型的校验
 * 名单，没有一条是协议规定的。所以这件事按 agentId 定址，而不是让通用层认准
 * 一家的格式（那正是这次重构拆掉的东西）。
 *
 * 缺席是有意义的答案：表示我们说不出该怎么给这一家写目录，界面于是不画那个
 * 入口，而不是画一个点了会失败的按钮。
 */
export interface AgentCatalogCodec {
  /** 把内置预设序列化成这一家目录命令认的文档。 */
  readonly catalogDocument: (presets: readonly AgentProviderPreset[]) => string
  /** 把一家已配置的 provider 序列化成同一种文档（一次性导入用）。 */
  readonly importDocument: (provider: AgentProviderState) => string
  /** 这一家该拿哪个模型当 default_model；一条都不合格时缺席。 */
  readonly defaultModelId: (provider: AgentProviderState) => string | undefined
  /** 同一个问题的另一半：手上只有内置预设时。 */
  readonly presetDefaultModelId: (preset: AgentProviderPreset) => string | undefined
}

const KIMI: AgentCatalogCodec = {
  catalogDocument: agentProviderCatalogDocument,
  importDocument: agentProviderImportDocument,
  defaultModelId: agentProviderDefaultModelId,
  presetDefaultModelId: builtinProviderDefaultModelId,
}

const CODECS: Readonly<Record<string, AgentCatalogCodec>> = { kimi: KIMI }

export function agentCatalogCodec(agentId: string): AgentCatalogCodec | undefined {
  return CODECS[agentId]
}
