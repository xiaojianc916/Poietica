import { describe, expect, it } from 'vitest'
import {
  beginFetch,
  completeFetch,
  decodeMarketplaceCatalog,
  failFetch,
  latestCatalog,
  MARKETPLACE_ABSENT,
  shouldFetchOnOpen,
} from './marketplace'

const CATALOG = {
  version: '2',
  plugins: [
    {
      id: 'kimi-datasource',
      displayName: '数据源',
      source: 'https://github.com/MoonshotAI/kimi-code',
      trust: 'kimi-official',
    },
  ],
}

describe('decodeMarketplaceCatalog', () => {
  it('版本号对不上就整份拒收', () => {
    expect(decodeMarketplaceCatalog({ version: '1', plugins: [] }, 'now').kind).toBe('undecodable')
  })

  it('条目里的来源当场解析成结构，不留字符串', () => {
    const decoded = decodeMarketplaceCatalog(CATALOG, '2026-01-01T00:00:00.000Z')

    if (decoded.kind !== 'decoded') {
      throw new Error('这份目录是合法的')
    }

    expect(decoded.catalog.entries[0]?.source).toEqual({
      kind: 'github',
      owner: 'MoonshotAI',
      repo: 'kimi-code',
      ref: { kind: 'default-branch' },
    })
  })

  it('没声明 trust 的条目落到 third-party', () => {
    const decoded = decodeMarketplaceCatalog(
      { version: '2', plugins: [{ id: 'demo', source: '/tmp/demo' }] },
      'now',
    )

    if (decoded.kind !== 'decoded') {
      throw new Error('这份目录是合法的')
    }

    expect(decoded.catalog.entries[0]?.trust).toBe('third-party')
  })
})

describe('市场目录的取用策略', () => {
  it('只有从来没取过才自动拉', () => {
    expect(shouldFetchOnOpen(MARKETPLACE_ABSENT)).toBe(true)
    expect(shouldFetchOnOpen(completeFetch(MARKETPLACE_ABSENT, CATALOG, 'now'))).toBe(false)
  })

  it('刷新失败时上一份仍然看得见', () => {
    const ready = completeFetch(MARKETPLACE_ABSENT, CATALOG, 'now')
    const failed = failFetch(beginFetch(ready), '网络不通')

    expect(failed.kind).toBe('failed')
    expect(latestCatalog(failed)?.entries).toHaveLength(1)
  })

  it('拉回来一份解不开的目录，等同刷新失败，旧目录不清空', () => {
    const ready = completeFetch(MARKETPLACE_ABSENT, CATALOG, 'now')
    const broken = completeFetch(ready, { version: '3' }, 'later')

    expect(broken.kind).toBe('failed')
    expect(latestCatalog(broken)?.entries).toHaveLength(1)
  })
})
