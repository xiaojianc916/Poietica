import type { AgentCatalogCodec } from './catalog-contract'
import { kimiCatalogCodec } from './kimi/catalog'

/*
 * 哪几家 agent 说得出「目录该怎么写」。
 *
 * 接第 N 家 = 新增 <id>/catalog.ts 交出一个 AgentCatalogCodec，然后在这张表里
 * 加一行。通用层一个字都不用改；如果改了，就说明还没解耦干净。
 *
 * 表是开放的而不是封闭的：一家 agent 完全可以不从我们这里写目录（它可能压根没有目录
 * 这个概念），那就不在表里 —— 取不到就是取不到，界面照缺席处置。
 */
const CODECS: Readonly<Record<string, AgentCatalogCodec>> = { kimi: kimiCatalogCodec }

export function agentCatalogCodec(agentId: string): AgentCatalogCodec | undefined {
  return CODECS[agentId]
}
