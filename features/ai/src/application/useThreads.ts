import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ThreadPort, ThreadRecord } from '../contracts/thread-port'

/** Shown for a conversation nothing has named yet. */
const FALLBACK_TITLE = 'New Agent'

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

/** One open tab. */
export interface ThreadTab {
  readonly threadId: string
  readonly title: string
}

/** Conversations, their tabs, and the names to show. */
export interface ThreadsSelection {
  readonly threads: readonly ThreadRecord[]
  readonly tabs: readonly ThreadTab[]
  readonly activeThreadId: string | null
  readonly titleOf: (threadId: string) => string
  readonly create: () => Promise<void>
  readonly activate: (threadId: string) => void
  readonly openInNewTab: (threadId: string) => void
  readonly closeTab: (threadId: string) => void
  readonly nameFromMessage: (threadId: string, message: string) => void
  readonly refresh: () => Promise<void>
  readonly failure: string | null
}

/**
 * Holds the conversation list and the tab strip.
 *
 * A name has three sources and they do not compete: an official name is the
 * agent's own and always wins; a stand in taken from the first thing the
 * user said is kept in memory only, so it can never be mistaken for the
 * real one later; before either exists a conversation is shown as AI.
 */
export const useThreads = (port: ThreadPort | undefined): ThreadsSelection => {
  const [threads, setThreads] = useState<readonly ThreadRecord[]>([])
  const [openIds, setOpenIds] = useState<readonly string[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [provisional, setProvisional] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (port === undefined) {
      return
    }
    try {
      const found = await port.list()
      setThreads(found)
      setFailure(null)
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : FAILURE_FALLBACK)
    }
  }, [port])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const titleOf = useCallback(
    (threadId: string): string => {
      const found = threads.find((thread) => thread.threadId === threadId)
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

  const activate = useCallback(
    (threadId: string) => {
      /*
       * Opening a conversation from the list replaces the one on screen.
       * The list is navigation, not a tab factory: piling up a tab per
       * click was why switching looked like it did nothing. A conversation
       * already open is brought forward rather than duplicated.
       */
      setOpenIds((open) => {
        if (open.includes(threadId)) {
          return open
        }

        const at = activeThreadId === null ? -1 : open.indexOf(activeThreadId)

        if (at === -1) {
          return [...open, threadId]
        }

        return open.map((id, index) => (index === at ? threadId : id))
      })
      setActiveThreadId(threadId)
    },
    [activeThreadId],
  )

  const openInNewTab = useCallback((threadId: string) => {
    setOpenIds((open) => (open.includes(threadId) ? open : [...open, threadId]))
  }, [])

  const closeTab = useCallback((threadId: string) => {
    setOpenIds((open) => open.filter((id) => id !== threadId))
    setActiveThreadId((active) => (active === threadId ? null : active))
  }, [])

  const nameFromMessage = useCallback(
    (threadId: string, message: string) => {
      const found = threads.find((thread) => thread.threadId === threadId)
      if (found !== undefined && found.titleSource === 'official') {
        return
      }
      setProvisional((named) => ({ ...named, [threadId]: shorten(message) }))
    },
    [threads],
  )

  const create = useCallback(async () => {
    if (port === undefined) {
      return
    }
    try {
      const opened = await port.open()
      /*
       * A conversation joins the list once something has been said in it,
       * so this only opens a tab. Adding it here left a record of every
       * conversation that never happened.
       */
      setOpenIds((open) => [...open, opened.thread.threadId])
      setActiveThreadId(opened.thread.threadId)
      setFailure(null)
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : FAILURE_FALLBACK)
    }
  }, [port])

  const tabs = useMemo(
    () => openIds.map((threadId) => ({ threadId, title: titleOf(threadId) })),
    [openIds, titleOf],
  )

  return {
    threads,
    tabs,
    activeThreadId,
    titleOf,
    create,
    activate,
    openInNewTab,
    closeTab,
    nameFromMessage,
    refresh,
    failure,
  }
}
