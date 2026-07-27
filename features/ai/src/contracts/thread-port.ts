import type { SessionConfigControl } from './session-config-contract'

/** Where a conversation name came from. */
export type ThreadTitleSource = 'official' | 'message' | 'fallback'

/** One conversation, as the platform reports it. */
export interface ThreadRecord {
  readonly threadId: string
  /** The agent session it is holding, where it holds one. */
  readonly sessionId: string | null
  readonly title: string
  readonly titleSource: ThreadTitleSource
  readonly updatedAt: string
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
  readonly open: () => Promise<OpenedThread>
}
