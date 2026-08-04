import * as v from 'valibot'

import { isWorkspaceSurfaceId, type RepositoryId } from '../domain/index'

/**
 * 落盘形状。
 *
 * 与视图模型分开声明：视图模型里的 isActive 是投影出来的派生位，
 * 存下来就会出现「存了两份 active」。落盘只存 activeIndex。
 */
const PersistedTabSchema = v.variant('kind', [
  v.object({
    kind: v.literal('conversation'),
    threadId: v.pipe(v.string(), v.nonEmpty()),
    title: v.string(),
  }),
  v.object({
    kind: v.literal('workspace'),
    surfaceId: v.custom<string>(isWorkspaceSurfaceId),
  }),
])

export const PersistedWorkbenchStateSchema = v.object({
  version: v.literal(1),
  activeIndex: v.pipe(v.number(), v.integer(), v.minValue(0)),
  tabs: v.array(PersistedTabSchema),
})

export type PersistedWorkbenchState = v.InferOutput<typeof PersistedWorkbenchStateSchema>

/** 工作台状态按仓库分域存取。 */
export interface WorkbenchStatePort {
  readonly read: (repositoryId: RepositoryId) => Promise<PersistedWorkbenchState | null>
  readonly write: (repositoryId: RepositoryId, state: PersistedWorkbenchState) => Promise<void>
}

/**
 * 仓库门面。
 *
 * listRecent 是「最近打开」，按 lastOpenedAt 倒序由实现保证；
 * probe 只读磁盘事实（是否 git、当前分支），不写任何状态。
 */
export interface RepositoryPort {
  readonly listRecent: () => Promise<readonly import('../domain/index').RepositoryRef[]>
  readonly probe: (rootPath: string) => Promise<import('../domain/index').RepositoryRef>
  readonly remember: (rootPath: string) => Promise<import('../domain/index').RepositoryRef>
  readonly forget: (repositoryId: RepositoryId) => Promise<void>
}

/** 没有宿主时的空实现：单测与 storybook 用，不进产品路径。 */
export const inMemoryWorkbenchStatePort = (): WorkbenchStatePort => {
  const store = new Map<RepositoryId, PersistedWorkbenchState>()

  return {
    read: async (repositoryId) => store.get(repositoryId) ?? null,
    write: async (repositoryId, state) => {
      store.set(repositoryId, state)
    },
  }
}
