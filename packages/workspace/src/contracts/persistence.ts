import * as v from 'valibot'

import type { RepositoryId, RepositoryRef } from '../domain/repository'

/**
 * 工作台状态的持久化契约。
 *
 * 这里只有形状与端口，没有实现：实现属于宿主（Tauri 侧的
 * crates/persistence，或测试自备的替身）。契约包内置一个内存实现，
 * 等于让生产代码可以顺手依赖一个永不落盘的假货。
 */

export const PersistedTabSchema = v.object({
  id: v.string(),
  kind: v.picklist(['conversation', 'workspace']),
  ref: v.string(),
  title: v.string(),
})

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
