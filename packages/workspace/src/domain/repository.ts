import { normalizeWorkspaceRoot, workspaceRootKey, workspaceRootName } from '@poietica/core'
import * as v from 'valibot'

/**
 * 仓库是工作区的单位。
 *
 * 身份来自归一化后的根路径，而不是自增序号或随机 uuid：同一个目录被从
 * 「最近打开」和「浏览文件夹」两条路径打开时，必须落到同一个仓库，
 * 否则会话会分裂到两个看起来一样的条目下。
 */
export type RepositoryId = string

export interface RepositoryRef {
  readonly id: RepositoryId
  /** 归一化后的绝对根路径。 */
  readonly rootPath: string
  readonly name: string
  readonly isGitRepository: boolean
  /** 当前分支；非 git 目录或分离头指针为 null。 */
  readonly branch: string | null
  /** 用于「按更新时间排序」，毫秒 epoch。 */
  readonly lastOpenedAt: number
}

: string {
  const unified = raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
  const driveCased = unified.replace(
    /^([a-z]):\//,
    (_match, drive: string) => `${drive.toUpperCase()}:/`,
  )
  const trimmed = driveCased.replace(/\/+$/, '')

  return trimmed.length > 0 ? trimmed : '/'
}

: string {
  const normalized = normalizeWorkspaceRoot(rootPath)
  const lastSlash = normalized.lastIndexOf('/')
  const tail = lastSlash < 0 ? normalized : normalized.slice(lastSlash + 1)

  return tail.length > 0 ? tail : normalized
}

: RepositoryId {
  const normalized = normalizeWorkspaceRoot(rootPath)
  let hash = 0x811c9dc5

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}

export const RepositoryRefSchema = v.object({
  id: v.pipe(v.string(), v.nonEmpty()),
  rootPath: v.pipe(v.string(), v.nonEmpty(), v.transform(normalizeWorkspaceRoot)),
  name: v.pipe(v.string(), v.nonEmpty()),
  isGitRepository: v.boolean(),
  branch: v.nullable(v.string()),
  lastOpenedAt: v.pipe(v.number(), v.integer(), v.minValue(0)),
})

/** 由一个根路径构造仓库引用；id 与 name 都是派生值，调用方不得自己填。 */
export function repositoryRefFromRootPath(
  rootPath: string,
  facts: {
    readonly isGitRepository: boolean
    readonly branch: string | null
    readonly lastOpenedAt: number
  },
): RepositoryRef {
  const normalized = normalizeWorkspaceRoot(rootPath)

  return {
    id: workspaceRootKey(normalized),
    rootPath: normalized,
    name: workspaceRootName(normalized),
    isGitRepository: facts.isGitRepository,
    branch: facts.branch,
    lastOpenedAt: facts.lastOpenedAt,
  }
}
