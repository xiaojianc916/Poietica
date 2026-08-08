import * as v from 'valibot'

import {
  PLUGIN_TRUST_TIERS,
  type PluginInstallSource,
  type PluginTrustTier,
  UNLISTED_TRUST,
} from './install-source'

/*
 * 偏好：installed.json 里到底记着什么。
 *
 * 它不再决定「装了什么」。装了什么的真相是 plugins/ 下那些带清单的目录 —— 上一版
 * 是反过来的：账本说了算，磁盘只当查找表。于是账本形状一改（把 specifier 换成
 * source），旧文件整份解不开，人早就装好的插件当场从界面上消失，卡片又变回「安装」，
 * 而且下一次写入还会把旧记录整批覆盖。
 *
 * VS Code 扫 extensions/ 下的 package.json，Obsidian 扫 plugins/<id>/manifest.json，
 * Zed 由 installed/ 重新生成索引 —— 三家都是磁盘说了算、配置文件只记开关，理由
 * 就是这个。
 *
 * 这里只记推导不出来的那几件事：拨过的开关、从哪来、什么时候来、当时目录怎么标它。
 * 解码逐条进行：一条坏记录只丢那一条；整份读不懂就是「没有偏好」，而没有偏好只
 * 意味着全部按默认呈现，不再意味着什么都没装。
 */

export const PLUGIN_PREFERENCES_VERSION = '1'

export interface PluginPreference {
  readonly enabled: boolean
  readonly disabledMcpServers: readonly string[]
  readonly source: PluginInstallSource | undefined
  readonly trust: PluginTrustTier
  /** ISO-8601。手动放进 plugins/ 的目录没有这一项。 */
  readonly installedAt: string | undefined
}

export type PluginPreferences = ReadonlyMap<string, PluginPreference>

/* 磁盘上有、偏好里没有的那些走这一档：开着，来历不明，因而没有背书。 */
export const DEFAULT_PREFERENCE: PluginPreference = {
  enabled: true,
  disabledMcpServers: [],
  source: undefined,
  trust: UNLISTED_TRUST,
  installedAt: undefined,
}

const RawGitHubRef = v.variant('kind', [
  v.object({ kind: v.literal('default-branch') }),
  v.object({ kind: v.literal('tree'), ref: v.string() }),
  v.object({ kind: v.literal('release-tag'), tag: v.string() }),
  v.object({ kind: v.literal('commit'), sha: v.string() }),
])

const RawSource = v.variant('kind', [
  v.object({ kind: v.literal('directory'), path: v.string() }),
  v.object({ kind: v.literal('archive'), url: v.string() }),
  v.object({
    kind: v.literal('github'),
    owner: v.string(),
    repo: v.string(),
    ref: RawGitHubRef,
    subdirectory: v.optional(v.string()),
  }),
])

const RawPreference = v.looseObject({
  enabled: v.optional(v.boolean()),
  disabledMcpServers: v.optional(v.array(v.string())),
  source: v.optional(RawSource),
  trust: v.optional(v.picklist(PLUGIN_TRUST_TIERS)),
  installedAt: v.optional(v.string()),
})

const RawFile = v.looseObject({
  version: v.literal(PLUGIN_PREFERENCES_VERSION),
  plugins: v.record(v.string(), v.unknown()),
})

/* 判别联合解出来之后补齐可空字段，让它与领域类型逐字对上。 */
function toSource(raw: v.InferOutput<typeof RawSource>): PluginInstallSource {
  return raw.kind === 'github' ? { ...raw, subdirectory: raw.subdirectory } : raw
}

export function decodePluginPreferences(contents: string | null): PluginPreferences {
  const preferences = new Map<string, PluginPreference>()

  if (contents === null) {
    return preferences
  }

  let raw: unknown

  try {
    raw = JSON.parse(contents)
  } catch {
    return preferences
  }

  const parsed = v.safeParse(RawFile, raw)

  if (!parsed.success) {
    return preferences
  }

  for (const [pluginId, entry] of Object.entries(parsed.output.plugins)) {
    const one = v.safeParse(RawPreference, entry)

    if (!one.success) {
      continue
    }

    preferences.set(pluginId, {
      enabled: one.output.enabled ?? DEFAULT_PREFERENCE.enabled,
      disabledMcpServers: one.output.disabledMcpServers ?? [],
      source: one.output.source === undefined ? undefined : toSource(one.output.source),
      trust: one.output.trust ?? UNLISTED_TRUST,
      installedAt: one.output.installedAt,
    })
  }

  return preferences
}

/* 按 id 排序再写：这份文件人会去看，也会进 diff，顺序抖动只会制造噪音。 */
export function encodePluginPreferences(preferences: PluginPreferences): string {
  const plugins: Record<string, PluginPreference> = {}

  for (const pluginId of [...preferences.keys()].sort()) {
    const preference = preferences.get(pluginId)

    if (preference !== undefined) {
      plugins[pluginId] = preference
    }
  }

  return `${JSON.stringify({ version: PLUGIN_PREFERENCES_VERSION, plugins }, null, 2)}\n`
}
