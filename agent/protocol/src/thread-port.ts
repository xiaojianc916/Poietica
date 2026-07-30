import type { SessionConfigControl } from './session-config-contract'

/**
 * Where a conversation name came from.
 *
 * Three, and the platform can report no other: the name the user typed, one
 * taken from the opening message, and the placeholder shown before there was
 * anything to take a name from.
 *
 * A fourth used to sit above all of them — the title the agent wrote in its
 * own store when it created the session. It is written once and never
 * revised, so ranking it above what the user actually said is what turned
 * this list into a column of the words New Session. It is gone from the
 * platform, and the ranking below no longer mentions it.
 */
export type ThreadTitleSource = 'manual' | 'message' | 'fallback'

/** One conversation, as the platform reports it. */
export interface ThreadRecord {
  readonly threadId: string
  /** The agent session it is holding, where it holds one. */
  readonly sessionId: string | null
  readonly title: string
  readonly titleSource: ThreadTitleSource
  readonly updatedAt: string
  /** Whether it is held at the top of the list. */
  readonly pinned?: boolean
}

/** A conversation that was just opened, and what its session offers. */
export interface OpenedThread {
  readonly thread: ThreadRecord
  readonly selectors: readonly SessionConfigControl[]
}

/**
 * Conversations, as the interface needs them.
 *
 * Opening one is opening an agent session: the two are created together,
 * so a tab always stands for something the agent knows about.
 */
export interface ThreadPort {
  readonly list: () => Promise<readonly ThreadRecord[]>
  /**
   * 打开一条对话：不点名就新开一条，点名就让那一条握住一个会话。
   *
   * 点开一条上次运行留下的对话也走这里。它存着的会话号在新的 agent 进程里不是
   * 活的，但那条会话仍在 agent 那侧：原生侧因此走 ACP 的 session/load 把它装载
   * 回来，号不变，上下文因此还在。此前这里写的是"开一个新的并改写持有关系" ——
   * 那不是设计，那是一个把上下文丢掉、并且顺手覆盖掉旧号的 bug。
   *
   * 只有 agent 在握手时声明它不装载旧会话，才会真的新开一条。三种情况都在同
   * 一次答复里带回整张选择器表。
   */
  readonly open: (threadId?: string) => Promise<OpenedThread>
  /** Renames one. The name becomes the user's and outlives the agent's. */
  readonly rename?: (threadId: string, title: string) => Promise<void>
  readonly remove?: (threadId: string) => Promise<void>
  readonly setPinned?: (threadId: string, pinned: boolean) => Promise<void>
}
