import type { ThreadPort, ThreadRecord } from '@poietica/agent-protocol'
import { useCallback, useEffect, useMemo, useState } from 'react'

/** Shown for a conversation nothing has named yet: the words of the entry. */
const FALLBACK_TITLE = '新建对话'

/** How much of a stand in title a tab can carry. */
const TITLE_LIMIT = 24

const FAILURE_FALLBACK = '读取会话记录失败。'

/** Cuts a stand in title down to something a tab can show. */
export const shorten = (text: string): string => {
  const tidy = text.trim().replace(/\s+/g, ' ')
  if (tidy.length === 0) {
    return FALLBACK_TITLE
  }
  if (tidy.length <= TITLE_LIMIT) {
    return tidy
  }
  return `${tidy.slice(0, TITLE_LIMIT)}…`
}

/**
 * Conversations and the names to show.
 *
 * Which conversation is open, and in which tab, belongs to the workbench.
 * This held a second copy of both and nothing read it: the sidebar took its
 * highlight from the active surface and the tab strip from the workbench
 * tabs, so the copy here could only ever drift.
 */
export interface ThreadsSelection {
  readonly threads: readonly ThreadRecord[]
  readonly titleOf: (threadId: string) => string
  /** The stand in name a message would give a conversation. */
  readonly standInTitle: (message: string) => string
  readonly create: () => Promise<string | null>
  readonly nameFromMessage: (threadId: string, message: string) => void
  /** Renames one. A name the user typed is not replaced by a later title. */
  readonly rename: (threadId: string, title: string) => Promise<void>
  readonly remove: (threadId: string) => Promise<void>
  readonly setPinned: (threadId: string, pinned: boolean) => Promise<void>
  readonly refresh: () => Promise<void>
  /** True until the first read of the list has settled, either way. */
  readonly isLoading: boolean
  readonly failure: string | null
}

/**
 * Holds the conversation list and the tab strip.
 *
 * A name has three sources and they do not compete: an official name is the
 * agent's own and always wins; a stand in taken from the first thing the
 * user said is kept in memory only, so it can never be mistaken for the
 * real one later; before either exists it carries the name of the entry
 * it came from.
 */
export const useThreads = (port: ThreadPort | undefined): ThreadsSelection => {
  const [threads, setThreads] = useState<readonly ThreadRecord[]>([])
  const [provisional, setProvisional] = useState<Record<string, string>>({})
  /*
   * Conversations this session started, before a read has caught up.
   *
   * The platform records a conversation when its first turn begins, so a
   * read fired at the moment of sending can come back without it. Showing
   * the row at once and letting the next read own it is the ordinary
   * optimistic update; the alternative is a list that ignores what the
   * user just did.
   */
  const [pending, setPending] = useState<readonly ThreadRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [failure, setFailure] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (port === undefined) {
      setIsLoading(false)
      return
    }
    try {
      const found = await port.list()
      setThreads(found)
      setFailure(null)
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : FAILURE_FALLBACK)
    } finally {
      setIsLoading(false)
    }
  }, [port])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const titleOf = useCallback(
    (threadId: string): string => {
      const found = threads.find((thread) => thread.threadId === threadId)
      /* 用户自己起的名字压过一切，包括随后到来的官方标题。 */
      if (found !== undefined && found.titleSource === 'manual') {
        return found.title
      }
      if (found !== undefined && found.titleSource === 'official') {
        return found.title
      }
      const standIn = provisional[threadId]
      if (standIn !== undefined) {
        return standIn
      }
      if (found === undefined) {
        return FALLBACK_TITLE
      }
      return found.titleSource === 'fallback' ? FALLBACK_TITLE : shorten(found.title)
    },
    [provisional, threads],
  )

  const nameFromMessage = useCallback(
    (threadId: string, message: string) => {
      const found = threads.find((thread) => thread.threadId === threadId)
      if (found !== undefined && found.titleSource === 'official') {
        return
      }
      const standIn = shorten(message)
      setProvisional((named) => ({ ...named, [threadId]: standIn }))
      if (found !== undefined) {
        return
      }
      /* Nothing has read this conversation back yet, so show it now. */
      setPending((held) =>
        held.some((thread) => thread.threadId === threadId)
          ? held
          : [
              ...held,
              {
                threadId,
                sessionId: null,
                title: standIn,
                titleSource: 'message' as const,
                updatedAt: new Date().toISOString(),
              },
            ],
      )
    },
    [threads],
  )

  const create = useCallback(async (): Promise<string | null> => {
    if (port === undefined) {
      return null
    }
    try {
      const opened = await port.open()
      /*
       * A conversation joins the list once something has been said in it.
       * Adding it here left a record of every conversation that never
       * happened. Where it is shown is the workbench's business, not ours.
       */
      setFailure(null)
      return opened.thread.threadId
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : FAILURE_FALLBACK)
      return null
    }
  }, [port])

  /*
   * 三个动作：先改本地，再落库，再重读。
   *
   * 立刻可见是列表类界面的通行做法，而真相仍然只有一个来源；端口没有
   * 实现某个动作时什么都不做，界面不会假装做过。
   */
  const rename = useCallback(
    async (threadId: string, title: string) => {
      const act = port?.rename
      const named = title.trim()
      if (act === undefined || named.length === 0) {
        return
      }
      setThreads((held) =>
        held.map((thread) =>
          thread.threadId === threadId
            ? { ...thread, title: named, titleSource: 'manual' as const }
            : thread,
        ),
      )
      setProvisional((held) =>
        Object.fromEntries(Object.entries(held).filter(([id]) => id !== threadId)),
      )
      try {
        await act(threadId, named)
        setFailure(null)
      } catch (reason) {
        setFailure(reason instanceof Error ? reason.message : FAILURE_FALLBACK)
      }
      await refresh()
    },
    [port, refresh],
  )

  const remove = useCallback(
    async (threadId: string) => {
      const act = port?.remove
      if (act === undefined) {
        return
      }
      setThreads((held) => held.filter((thread) => thread.threadId !== threadId))
      setPending((held) => held.filter((thread) => thread.threadId !== threadId))
      try {
        await act(threadId)
        setFailure(null)
      } catch (reason) {
        setFailure(reason instanceof Error ? reason.message : FAILURE_FALLBACK)
      }
      await refresh()
    },
    [port, refresh],
  )

  const setPinned = useCallback(
    async (threadId: string, pinned: boolean) => {
      const act = port?.setPinned
      if (act === undefined) {
        return
      }
      setThreads((held) =>
        held.map((thread) => (thread.threadId === threadId ? { ...thread, pinned } : thread)),
      )
      try {
        await act(threadId, pinned)
        setFailure(null)
      } catch (reason) {
        setFailure(reason instanceof Error ? reason.message : FAILURE_FALLBACK)
      }
      await refresh()
    },
    [port, refresh],
  )

  /* 刚开口的对话排在最前，直到下一次读取把它认领走。 */
  const listed = useMemo(() => {
    if (pending.length === 0) {
      return threads
    }

    const known = new Set(threads.map((thread) => thread.threadId))
    const extra = pending.filter((thread) => !known.has(thread.threadId))

    return extra.length === 0 ? threads : [...extra, ...threads]
  }, [pending, threads])

  return {
    threads: listed,
    titleOf,
    standInTitle: shorten,
    create,
    nameFromMessage,
    rename,
    remove,
    setPinned,
    refresh,
    isLoading,
    failure,
  }
}
