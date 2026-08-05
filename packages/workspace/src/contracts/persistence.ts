import * as v from 'valibot'

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

/**
 * 按工作区分域的工作台状态读写。读不到返回 null，而不是抛错。
 *
 * 键是一个由归一化根路径派生的、文件名安全的定长 token：一条绝对路径当不了
 * 文件名（自带分隔符、有长度上限、还分大小写），原生侧那一层也只收 hex
 * （crates/persistence/src/workspace_state.rs）。派生它的那个函数与它的第一个
 * 调用方同一笔落地，不提前摆在这里。
 *
 * 键的类型就是 string，不另立别名：一个等于 string 的类型别名在 TypeScript 里
 * 不产生任何检查，它挡不住把一条对话 id 传进来，只是把「这是什么」从参数名搬
 * 到别处再说一遍。
 */
export interface WorkbenchStatePort {
  read(workspaceKey: string): Promise<PersistedWorkbenchState | null>
  write(workspaceKey: string, state: PersistedWorkbenchState): Promise<void>
}
