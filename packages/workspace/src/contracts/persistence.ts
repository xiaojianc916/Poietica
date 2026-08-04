import * as v from 'valibot'

import type { RepositoryId, RepositoryRef } from '../domain/repository'
import { isWorkspaceSurfaceId, type WorkspaceSurfaceId } from '../domain/surface-registry'

/**
 * 工作台状态的持久化契约。
 *
 * 这里只有形状与端口，没有实现：实现属于宿主（Tauri 侧的
 * crates/persistence，或测试自备的替身）。
 */

/*
 * 一格标签的形状与原生侧 PersistedTab 逐字段对齐（serde 的 tag = "kind"、
 * camelCase）。它是判别联合而不是扁平记录：工作区那一格没有自己的标题，
 * 标题是注册表已经拥有的事实；对话那一格没有 surfaceId 可填。
 *
 * 此前这里是四个扁平字段 —— 一个原生侧从不写、控制器也从不产出的第三种
 * 形状。同一份 JSON 有三份形状描述时，校验器挡住的只会是自己人。
 */
const PersistedConversationTabSchema = v.object({
  kind: v.literal('conversation'),
  threadId: v.string(),
  title: v.string(),
})

const PersistedWorkspaceTabSchema = v.object({
  kind: v.literal('workspace'),
  /* 未知表面在这里就被拦下，读回来的 id 因此不需要在控制器里断言一次。 */
  surfaceId: v.custom<WorkspaceSurfaceId>(
    (input) => typeof input === 'string' && isWorkspaceSurfaceId(input),
    '未知的工作区表面',
  ),
})

export const PersistedTabSchema = v.variant('kind', [
  PersistedConversationTabSchema,
  PersistedWorkspaceTabSchema,
])

export const PersistedWorkbenchStateSchema = v.object({
  version: v.literal(1),
  activeIndex: v.number(),
  tabs: v.array(PersistedTabSchema),
})

export type PersistedTab = v.InferOutput<typeof PersistedTabSchema>
export type PersistedWorkbenchState = v.InferOutput<typeof PersistedWorkbenchStateSchema>

/** 按仓库分域的工作台状态读写。读不到返回 null，而不是抛错。 */
export interface WorkbenchStatePort {
  read(repositoryId: RepositoryId): Promise<PersistedWorkbenchState | null>
  write(repositoryId: RepositoryId, state: PersistedWorkbenchState): Promise<void>
}

/** 仓库清单与探测。对应 Cursor 仓库选择器的 Recents / Repos 两栏。 */
export interface RepositoryPort {
  listRecent(): Promise<readonly RepositoryRef[]>
  probe(rootPath: string): Promise<RepositoryRef | null>
  remember(ref: RepositoryRef): Promise<void>
  forget(id: RepositoryId): Promise<void>
}
