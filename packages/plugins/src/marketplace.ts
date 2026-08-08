import { assertUnreachable } from '@poietica/core'
import * as v from 'valibot'
import {
  PLUGIN_TRUST_TIERS,
  type PluginInstallSource,
  type PluginTrustTier,
  parseInstallSource,
  UNLISTED_TRUST,
} from './install-source'

/* 目录格式的版本号由上游定：认不出版本就整份拒收，不去猜里面是什么。 */
export const MARKETPLACE_CATALOG_VERSION = '2'

export interface MarketplaceEntry {
  readonly id: string
  readonly displayName: string
  readonly source: PluginInstallSource
  readonly trust: PluginTrustTier
}

export interface MarketplaceCatalog {
  readonly entries: readonly MarketplaceEntry[]
  /* 这一份是什么时候取回来的：刷新按钮旁边显示的就是它。 */
  readonly fetchedAt: string
}

const RawEntry = v.looseObject({
  id: v.string(),
  displayName: v.optional(v.string()),
  source: v.string(),
  trust: v.optional(v.picklist(PLUGIN_TRUST_TIERS)),
})

const RawCatalog = v.looseObject({
  version: v.literal(MARKETPLACE_CATALOG_VERSION),
  plugins: v.array(RawEntry),
})

export interface DecodedCatalog {
  readonly kind: 'decoded'
  readonly catalog: MarketplaceCatalog
}

export interface UndecodableCatalog {
  readonly kind: 'undecodable'
  readonly reason: string
}

export type CatalogDecoding = DecodedCatalog | UndecodableCatalog

/*
 * 目录里的 source 在解码当场就变成结构，不以字符串的形态往下传：字符串会被
 * 沿途每一处各自解释一遍，而解释不一致时没有任何东西会报错。
 */
export function decodeMarketplaceCatalog(raw: unknown, fetchedAt: string): CatalogDecoding {
  const parsed = v.safeParse(RawCatalog, raw)

  if (!parsed.success) {
    return { kind: 'undecodable', reason: parsed.issues.map((issue) => issue.message).join('; ') }
  }

  return {
    kind: 'decoded',
    catalog: {
      fetchedAt,
      entries: parsed.output.plugins.map((entry) => ({
        id: entry.id,
        displayName: entry.displayName ?? entry.id,
        source: parseInstallSource(entry.source),
        trust: entry.trust ?? UNLISTED_TRUST,
      })),
    },
  }
}

export interface AbsentCatalog {
  readonly kind: 'absent'
}

export interface FetchingCatalog {
  readonly kind: 'fetching'
  readonly previous: MarketplaceCatalog | undefined
}

export interface ReadyCatalog {
  readonly kind: 'ready'
  readonly catalog: MarketplaceCatalog
}

export interface FailedCatalog {
  readonly kind: 'failed'
  readonly previous: MarketplaceCatalog | undefined
  readonly reason: string
}

/*
 * 目录的四种状态。
 *
 * fetching 与 failed 都带着上一份：刷新失败时界面继续显示旧目录，而不是把人
 * 已经看着的东西清空 —— 清空是在惩罚用户，不是在报告事实。三个平行字段
 * （catalog / isRefreshing / error）写不出这条保证，只能靠人记得别清。
 */
export type MarketplaceState = AbsentCatalog | FailedCatalog | FetchingCatalog | ReadyCatalog

export const MARKETPLACE_ABSENT: MarketplaceState = { kind: 'absent' }

export function latestCatalog(state: MarketplaceState): MarketplaceCatalog | undefined {
  switch (state.kind) {
    case 'absent':
      return undefined
    case 'failed':
      return state.previous
    case 'fetching':
      return state.previous
    case 'ready':
      return state.catalog
    default:
      return assertUnreachable(state)
  }
}

/*
 * 只有从来没取过才自动拉一次。取回来之后落盘，之后每次打开读的都是那一份；
 * 再要新的是人按刷新。这条判据只有这一个地方说了算。
 */
export function shouldFetchOnOpen(state: MarketplaceState): boolean {
  return state.kind === 'absent'
}

export function beginFetch(state: MarketplaceState): MarketplaceState {
  return { kind: 'fetching', previous: latestCatalog(state) }
}

export function completeFetch(
  state: MarketplaceState,
  raw: unknown,
  fetchedAt: string,
): MarketplaceState {
  const decoded = decodeMarketplaceCatalog(raw, fetchedAt)

  if (decoded.kind === 'undecodable') {
    return { kind: 'failed', previous: latestCatalog(state), reason: decoded.reason }
  }

  return { kind: 'ready', catalog: decoded.catalog }
}

export function failFetch(state: MarketplaceState, reason: string): MarketplaceState {
  return { kind: 'failed', previous: latestCatalog(state), reason }
}
