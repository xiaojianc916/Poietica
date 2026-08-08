import { describe, expect, it } from 'vitest'
import {
  beginFetch,
  completeFetch,
  decodeMarketplaceCatalog,
  failFetch,
  latestCatalog,
  MARKETPLACE_ABSENT,
  parseMarketplaceOrigin,
  shouldFetchOnOpen,
} from './marketplace'

const UPSTREAM_URL =
  'https://raw.githubusercontent.com/MoonshotAI/kimi-code/main/plugins/marketplace.json'

const ORIGIN = parseMarketplaceOrigin(UPSTREAM_URL)

/* 逐字取自 MoonshotAI/kimi-code 的 plugins/marketplace.json。 */
const CATALOG = {
  version: '1',
  plugins: [
    {
      id: 'kimi-datasource',
      tier: 'official',
      displayName: 'Kimi Datasource',
      version: '3.3.0',
      description: 'Official datasource workflows.',
      keywords: ['data', 'mcp'],
      source: './official/kimi-datasource',
    },
    {
      id: 'superpowers',
      tier: 'curated',
      displayName: 'Superpowers',
      source: 'https://github.com/obra/superpowers',
    },
  ],
}

function decode(raw: unknown) {
  const decoded = decodeMarketplaceCatalog(raw, '2026-01-01T00:00:00.000Z', ORIGIN)

  if (decoded.kind !== 'decoded') {
    throw new Error(`这份目录应当是合法的：${decoded.reason}`)
  }

  return decoded.catalog
}

describe('parseMarketplaceOrigin', () => {
  it('认得 raw.githubusercontent 的四段形状', () => {
    expect(ORIGIN).toEqual({
      owner: 'MoonshotAI',
      repo: 'kimi-code',
      ref: { kind: 'tree', ref: 'main' },
      directory: 'plugins',
    })
  })

  it('认不出的地址没有仓库上下文', () => {
    expect(parseMarketplaceOrigin('https://example.com/marketplace.json')).toBeUndefined()
  })
})

describe('decodeMarketplaceCatalog', () => {
  it('上游那份目录能整份读进来', () => {
    expect(decode(CATALOG).entries).toHaveLength(2)
  })

  it('相对来源接到目录自己的仓库上，落成子目录', () => {
    expect(decode(CATALOG).entries[0]?.source).toEqual({
      kind: 'github',
      owner: 'MoonshotAI',
      repo: 'kimi-code',
      ref: { kind: 'tree', ref: 'main' },
      subdirectory: 'plugins/official/kimi-datasource',
    })
  })

  it('绝对来源照旧当自己解析', () => {
    expect(decode(CATALOG).entries[1]?.source).toEqual({
      kind: 'github',
      owner: 'obra',
      repo: 'superpowers',
      ref: { kind: 'default-branch' },
    })
  })

  it('tier 折成内部的信任档位', () => {
    expect(decode(CATALOG).entries.map((entry) => entry.trust)).toEqual([
      'kimi-official',
      'curated',
    ])
  })

  it('没见过的 tier 落到第三方，不拖垮整份目录', () => {
    const catalog = decode({ version: '1', plugins: [{ id: 'x', tier: '未来档位', source: '/x' }] })

    expect(catalog.entries[0]?.trust).toBe('third-party')
  })

  it('相对来源指到仓库外面时不接受', () => {
    const catalog = decode({ version: '1', plugins: [{ id: 'x', source: '../../etc/passwd' }] })

    expect(catalog.entries[0]?.source.kind).toBe('directory')
  })

  it('版本号对不上就整份拒收', () => {
    expect(decodeMarketplaceCatalog({ version: '2', plugins: [] }, 'now', ORIGIN).kind).toBe(
      'undecodable',
    )
  })
})

describe('市场目录的取用策略', () => {
  it('只有从来没取过才自动拉', () => {
    expect(shouldFetchOnOpen(MARKETPLACE_ABSENT)).toBe(true)
    expect(shouldFetchOnOpen(completeFetch(MARKETPLACE_ABSENT, CATALOG, 'now', ORIGIN))).toBe(false)
  })

  it('刷新失败时上一份仍然看得见', () => {
    const ready = completeFetch(MARKETPLACE_ABSENT, CATALOG, 'now', ORIGIN)
    const failed = failFetch(beginFetch(ready), '网络不通')

    expect(failed.kind).toBe('failed')
    expect(latestCatalog(failed)?.entries).toHaveLength(2)
  })

  it('拉回来一份解不开的目录，等同刷新失败，旧目录不清空', () => {
    const ready = completeFetch(MARKETPLACE_ABSENT, CATALOG, 'now', ORIGIN)
    const broken = completeFetch(ready, { version: '3' }, 'later', ORIGIN)

    expect(broken.kind).toBe('failed')
    expect(latestCatalog(broken)?.entries).toHaveLength(2)
  })
})
