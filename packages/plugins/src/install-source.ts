import { assertUnreachable } from '@poietica/core'

/*
 * 信任级别取自上游的三档徽章。它是市场目录声明的事实，不从 URL 猜 —— 猜出来
 * 的信任是最坏的一种信任。
 */
export const PLUGIN_TRUST_TIERS = ['kimi-official', 'curated', 'third-party'] as const

export type PluginTrustTier = (typeof PLUGIN_TRUST_TIERS)[number]

/* 目录之外装进来的一律 third-party：手动指路径那条通道没有任何东西为它背书。 */
export const UNLISTED_TRUST: PluginTrustTier = 'third-party'

/*
 * 非官方来源一律要人点头，且默认落在取消上。装一个插件是把别人的代码请进自己
 * 的会话，默认值应该是「不」。
 */
export function requiresInstallConfirmation(trust: PluginTrustTier): boolean {
  return trust !== 'kimi-official'
}

export interface DefaultBranchRef {
  readonly kind: 'default-branch'
}

export interface TreeRef {
  readonly kind: 'tree'
  readonly ref: string
}

export interface ReleaseTagRef {
  readonly kind: 'release-tag'
  readonly tag: string
}

export interface CommitRef {
  readonly kind: 'commit'
  readonly sha: string
}

export type GitHubRef = CommitRef | DefaultBranchRef | ReleaseTagRef | TreeRef

export interface DirectorySource {
  readonly kind: 'directory'
  readonly path: string
}

export interface ArchiveSource {
  readonly kind: 'archive'
  readonly url: string
}

export interface GitHubSource {
  readonly kind: 'github'
  readonly owner: string
  readonly repo: string
  readonly ref: GitHubRef
}

export type PluginInstallSource = ArchiveSource | DirectorySource | GitHubSource

const HTTP_PROTOCOLS = new Set(['http:', 'https:'])

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])

/*
 * 用 URL 解析 URL，不用正则切字符串：主机名规范化、端口、百分号编码、IDN ——
 * 这些边界情况平台已经解决过一遍，手搓必然漏。
 */
function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

/*
 * 判据是协议白名单，不是「能不能构造出 URL」：Windows 盘符路径会被 URL 当成
 * 协议解析成功 —— new URL('C:\\plugins\\demo') 不抛，protocol 是 'c:'。这个仓库
 * 的发布目标就是 x86_64-pc-windows-msvc，所以这条不是假想。
 */
function asHttpUrl(value: string): URL | undefined {
  const url = parseUrl(value)

  return url !== undefined && HTTP_PROTOCOLS.has(url.protocol) ? url : undefined
}

function parseGitHubRef(rest: readonly string[]): GitHubRef {
  const [kind, ...tail] = rest
  const joined = tail.join('/')

  if (kind === 'tree' && joined !== '') {
    return { kind: 'tree', ref: joined }
  }

  if (kind === 'commit' && joined !== '') {
    return { kind: 'commit', sha: joined }
  }

  if (kind === 'releases' && tail[0] === 'tag' && tail.length > 1) {
    return { kind: 'release-tag', tag: tail.slice(1).join('/') }
  }

  return { kind: 'default-branch' }
}

/*
 * 一条来源说明串到底是什么，只在这里判一次。上游支持四种：本地目录、直链压缩
 * 包、GitHub 仓库地址，以及 GitHub 地址上的三种定位（tree / releases-tag / commit）。
 */
export function parseInstallSource(specifier: string): PluginInstallSource {
  const url = asHttpUrl(specifier)

  if (url === undefined) {
    return { kind: 'directory', path: specifier }
  }

  if (!GITHUB_HOSTS.has(url.hostname)) {
    return { kind: 'archive', url: url.toString() }
  }

  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  const owner = segments[0]
  const repo = segments[1]

  if (owner === undefined || repo === undefined) {
    return { kind: 'archive', url: url.toString() }
  }

  return {
    kind: 'github',
    owner,
    repo: repo.replace(/\.git$/, ''),
    ref: parseGitHubRef(segments.slice(2)),
  }
}

export function describeInstallSource(source: PluginInstallSource): string {
  switch (source.kind) {
    case 'archive':
      return source.url
    case 'directory':
      return source.path
    case 'github':
      return `github.com/${source.owner}/${source.repo}`
    default:
      return assertUnreachable(source)
  }
}
