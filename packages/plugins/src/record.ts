import * as v from 'valibot'

import { PLUGIN_TRUST_TIERS, type PluginTrustTier, UNLISTED_TRUST } from './install-source'

/*
 * 账本：installed.json 里到底记着什么。
 *
 * 清单不在里面。清单的真相是 plugins/<id>/ 下那份文件，记一份副本进来就一定会和
 * 磁盘分叉 —— 改了插件目录里的 kimi.plugin.json，账本却还说着上一版。这里只记
 * 推导不出来的那几件事。
 *
 * specifier 存的是人当初给的那串原文，不是 describeInstallSource 的渲染结果：
 * 存输入，parseInstallSource 就仍然是唯一解析器，往返天然成立；存渲染结果就要
 * 再写一个反向解析器，那是第二套规则。
 */

export const PLUGIN_LEDGER_VERSION = '1'

export interface PluginRecord {
  readonly id: string
  readonly specifier: string
  readonly trust: PluginTrustTier
  readonly enabled: boolean
  /** ISO-8601。解析顺序按它排，所以它必须记下来而不是每次现算。 */
  readonly installedAt: string
  readonly disabledMcpServers: readonly string[]
}

export interface DecodedLedger {
  readonly kind: 'decoded'
  readonly records: readonly PluginRecord[]
}

export interface UndecodableLedger {
  readonly kind: 'undecodable'
  readonly reason: string
}

export type LedgerDecoding = DecodedLedger | UndecodableLedger

const RawRecord = v.looseObject({
  id: v.string(),
  specifier: v.string(),
  trust: v.optional(v.picklist(PLUGIN_TRUST_TIERS)),
  enabled: v.optional(v.boolean()),
  installedAt: v.string(),
  disabledMcpServers: v.optional(v.array(v.string())),
})

const RawLedger = v.looseObject({
  version: v.literal(PLUGIN_LEDGER_VERSION),
  plugins: v.array(RawRecord),
})

/*
 * 读不懂就整份拒收，不是当成空账本。
 *
 * 「一份读不懂的账本」与「还没装过任何插件」在磁盘上长得不一样，塌进同一个结果里，
 * 下一次写入就会把人装过的东西整批抹掉。没有文件才是空账本 —— 那是首次运行。
 */
export function decodePluginLedger(contents: string | null): LedgerDecoding {
  if (contents === null) {
    return { kind: 'decoded', records: [] }
  }

  let raw: unknown

  try {
    raw = JSON.parse(contents)
  } catch (cause: unknown) {
    return { kind: 'undecodable', reason: cause instanceof Error ? cause.message : String(cause) }
  }

  const parsed = v.safeParse(RawLedger, raw)

  if (!parsed.success) {
    return { kind: 'undecodable', reason: parsed.issues.map((issue) => issue.message).join('; ') }
  }

  return {
    kind: 'decoded',
    records: parsed.output.plugins.map((entry) => ({
      id: entry.id,
      specifier: entry.specifier,
      trust: entry.trust ?? UNLISTED_TRUST,
      enabled: entry.enabled ?? true,
      installedAt: entry.installedAt,
      disabledMcpServers: entry.disabledMcpServers ?? [],
    })),
  }
}

/* 缩进两格：这份文件人会去看，也会去手改。 */
export function encodePluginLedger(records: readonly PluginRecord[]): string {
  return `${JSON.stringify({ version: PLUGIN_LEDGER_VERSION, plugins: records }, null, 2)}\n`
}
