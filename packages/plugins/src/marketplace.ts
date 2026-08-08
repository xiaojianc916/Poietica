import { assertUnreachable } from '@poietica/core'
import * as v from 'valibot'
import {
  type GitHubRef,
  type PluginInstallSource,
  type PluginTrustTier,
  parseInstallSource,
  UNLISTED_TRUST,
} from './install-source'

/*
 * 目录格式的版本号由上游定，认不出版本就整份拒收。
 *
 * 这个 "1" 是从 MoonshotAI/kimi-code 的 plugins/marketplace.json 第二行读来的。
 * 上一版写死 "2" —— 一个凭空造的数字，于是拉回来的第一份真目录当场被整份拒收，
 * 界面上只剩一句 Invalid type: Expected "2" but received "1"。
 */
export const MARKETPLACE_CATALOG_VERSION = '1'

/*
 * 上游那一列叫 tier，值是 official / curated；这个仓库内部用的是三档 trust。
 * 两套词汇在解码这一层就合并成一套，否则「上游怎么说」和「我们怎么判」会各自长大。
 *
 * 认不出的 tier 不拒收整份目录，只落到第三方：一个没见过的档位意味着没有背书，
 * 而没有背书恰好就是第三方的定义。为一个新档位把整份目录判死是不成比例的。
 */
const TIER_TRUST: Readonly<Record<string, PluginTrustTier>> = {
  official: 'kimi-official',
  curated: 'curated',
}

/**
 * 一份目录自己住在哪。
 *
 * 目录里的官方条目写的是相对路径（"./official/kimi-datasource"），相对的是目录
 * 文件自己所在的那个目录。没有这个上下文，那串东西会被当成本地路径，指向磁盘上
 * 不存在的地方 —— 四条官方条目就是这么全部装不上的。
 */
export interface MarketplaceOrigin {
  readonly owner: string
  readonly repo: string
  readonly ref: GitHubRef
  /** 目录文件所在目录，相对仓库根。仓库根是空串。 */
  readonly directory: string
}

const RAW_GITHUB_HOST = 'raw.githubusercontent.com'

/*
 * raw.githubusercontent.com/<owner>/<repo>/<ref>/<path...> 是 GitHub 取单文件原文的
 * 固定形状，这里的每一段都有确定含义，不需要猜。认不出这个形状就没有仓库上下文 ——
 * 那时相对路径只能按字面理解成本地路径，而那恰好也是它字面上的意思。
 */
export function parseMarketplaceOrigin(url: string): MarketplaceOrigin | undefined {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }

  if (parsed.hostname !== RAW_GITHUB_HOST) {
    return undefined
  }

  const segments = parsed.pathname.split('/').filter((segment) => segment !== '')
  const [owner, repo, ref, ...file] = segments

  if (owner === undefined || repo === undefined || ref === undefined || file.length === 0) {
    return undefined
  }

  return { owner, repo, ref: { kind: 'tree', ref }, directory: file.slice(0, -1).join('/') }
}

const RELATIVE_SOURCE = /^\.\.?\//

/*
 * 把目录里那条相对路径接到目录自己所在的目录上。".." 不接受 —— 一份目录没有理由
 * 指到自己仓库外面去，而放行它就等于让远端 JSON 决定我们从哪个仓库取代码。
 */
function joinInsideRepository(directory: string, relative: string): string | undefined {
  const segments = [...directory.split('/'), ...relative.split('/')].filter(
    (segment) => segment !== '' && segment !== '.',
  )

  return segments.includes('..') || segments.length === 0 ? undefined : segments.join('/')
}

function resolveEntrySource(
  specifier: string,
  origin: MarketplaceOrigin | undefined,
): PluginInstallSource {
  if (origin === undefined || !RELATIVE_SOURCE.test(specifier)) {
    return parseInstallSource(specifier)
  }

  const subdirectory = joinInsideRepository(origin.directory, specifier)

  return subdirectory === undefined
    ? parseInstallSource(specifier)
    : { kind: 'github', owner: origin.owner, repo: origin.repo, ref: origin.ref, subdirectory }
}

export interface MarketplaceEntry {
  readonly id: string
  readonly displayName: string
  readonly description: string | undefined
  readonly homepage: string | undefined
  readonly version: string | undefined
  /** 目录自带的分类词。卡片分组读它，不另立一张我们自己的分类表。 */
  readonly keywords: readonly string[]
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
  description: v.optional(v.string()),
  homepage: v.optional(v.string()),
  version: v.optional(v.string()),
  keywords: v.optional(v.array(v.string())),
  tier: v.optional(v.string()),
  source: v.string(),
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
export function decodeMarketplaceCatalog(
  raw: unknown,
  fetchedAt: string,
  origin: MarketplaceOrigin | undefined,
): CatalogDecoding {
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
        description: entry.description,
        homepage: entry.homepage,
        version: entry.version,
        keywords: entry.keywords ?? [],
        source: resolveEntrySource(entry.source, origin),
        trust: (entry.tier === undefined ? undefined : TIER_TRUST[entry.tier]) ?? UNLISTED_TRUST,
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
  origin: MarketplaceOrigin | undefined,
): MarketplaceState {
  const decoded = decodeMarketplaceCatalog(raw, fetchedAt, origin)

  if (decoded.kind === 'undecodable') {
    return { kind: 'failed', previous: latestCatalog(state), reason: decoded.reason }
  }

  return { kind: 'ready', catalog: decoded.catalog }
}

export function failFetch(state: MarketplaceState, reason: string): MarketplaceState {
  return { kind: 'failed', previous: latestCatalog(state), reason }
}
