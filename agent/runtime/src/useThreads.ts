import type {
  SessionConfigControl,
  SessionConfigPort,
  ThreadPort,
  ThreadRecord,
} from '@poietica/agent-protocol'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Shown for a conversation nothing has named yet: the words of the entry. */
const FALLBACK_TITLE = '新建对话'

/** How much of a stand in title a tab can carry. */
const TITLE_LIMIT = 24

const FAILURE_FALLBACK = '读取会话记录失败。'

/** 说的是选择器那一路，和上面那句不是同一件事。 */
const SELECTOR_FAILURE_FALLBACK = '这条对话没能连上 agent。'

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
  /** 这条对话所持有的会话给出的选择器；从没拿到过就是 undefined。 */
  readonly selectorsOf: (threadId: string) => readonly SessionConfigControl[] | undefined
  /** 认领一条不是本次运行开出来的对话。至多问一次。 */
  readonly adopt: (threadId: string) => void
  /** 改这条对话的一项会话设置；答案就是改完之后的整张表。 */
  readonly selectControl: (threadId: string, controlId: string, value: string) => void
  /** 上一次认领或改动失败时的说法，按对话记。 */
  readonly selectorFailureOf: (threadId: string) => string | undefined
  readonly retrySelectors: (threadId: string) => void
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
export const useThreads = (
  port: ThreadPort | undefined,
  config?: SessionConfigPort,
): ThreadsSelection => {
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
  /*
   * 选择器按对话记，三个到达口都是会话本身：新开一条对话时 session/new 报的
   * 那份、认领一条更早的对话时为它开出会话所报的那份、以及改一项之后 agent 回
   * 的那份。没有第四个，也没有一条"读设置"的路。
   *
   * 此前它由输入框旁边的一个 hook 自己持有，每次挂载和每次重试都重读一遍。
   * 而在原生侧，"还没有会话"是一张合法的空表，"连接正忙"是一个错误——两者
   * 摊在同一块状态上，于是同一个选择器一会儿整个消失，一会儿变成「会话设置
   * 读取失败」。开对话的那一次答复里明明已经带回了整张表，却被丢掉了。
   */
  const [selectors, setSelectors] = useState<Record<string, readonly SessionConfigControl[]>>({})
  const [selectorFailure, setSelectorFailure] = useState<Record<string, string>>({})
  /* 问过的对话不再问第二遍：重读是显式动作，不是渲染的副作用。 */
  const asked = useRef<Set<string>>(new Set())

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

  /*
   * 按 id 找一条对话：一次索引，而不是每一行各扫一遍整张表。
   *
   * 侧栏每画一行就问一次名字，于是原先的 find 让渲染是 O(行数²)。
   */
  const byId = useMemo(() => {
    const found = new Map<string, ThreadRecord>()

    for (const thread of threads) {
      found.set(thread.threadId, thread)
    }

    return found
  }, [threads])

  const titleOf = useCallback(
    (threadId: string): string => {
      const found = byId.get(threadId)

      /* 用户自己起的名字压过一切，包括随后到来的官方标题。 */
      if (found?.titleSource === 'manual' || found?.titleSource === 'official') {
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
    [byId, provisional],
  )

  const nameFromMessage = useCallback(
    (threadId: string, message: string) => {
      const found = byId.get(threadId)

      if (found?.titleSource === 'official') {
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
    [byId],
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
      /*
       * 会话是跟着这条对话一起开出来的，选择器就在同一个答复里。这是唯一
       * 不需要再问一次的时刻，此前它被丢在这里。
       */
      setSelectors((held) => ({ ...held, [opened.thread.threadId]: opened.selectors }))
      asked.current.add(opened.thread.threadId)
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
    },
    [port],
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
    },
    [port],
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
    },
    [port],
  )

  const remember = useCallback((threadId: string, offered: readonly SessionConfigControl[]) => {
    setSelectors((held) => ({ ...held, [threadId]: offered }))
    setSelectorFailure((held) =>
      Object.fromEntries(Object.entries(held).filter(([id]) => id !== threadId)),
    )
  }, [])

  const noteSelectorFailure = useCallback((threadId: string, reason: unknown) => {
    setSelectorFailure((held) => ({
      ...held,
      [threadId]: reason instanceof Error ? reason.message : SELECTOR_FAILURE_FALLBACK,
    }))
  }, [])

  const selectorsOf = useCallback(
    (threadId: string): readonly SessionConfigControl[] | undefined => selectors[threadId],
    [selectors],
  )

  const selectorFailureOf = useCallback(
    (threadId: string): string | undefined => selectorFailure[threadId],
    [selectorFailure],
  )

  /*
   * 认领一条不是本次运行开出来的对话：让它握住一个会话。
   *
   * 这不是"读一次设置"。原生侧在同一个答复里给出这条对话现在持有的会话，和
   * agent 为它报的整张选择器表，与新开一条对话走的是同一条路——所以选择器只
   * 有一个到达口，也就没有"空表"和"读失败"这两种半状态。
   */
  const read = useCallback(
    (threadId: string) => {
      if (port === undefined) {
        return
      }
      asked.current.add(threadId)
      port
        .open(threadId)
        .then((opened) => {
          remember(threadId, opened.selectors)
        })
        .catch((reason: unknown) => {
          noteSelectorFailure(threadId, reason)
        })
    },
    [noteSelectorFailure, port, remember],
  )

  /* 本次运行开出来的对话已经有答案，只有从列表里点开的那些需要认领。 */
  const adopt = useCallback(
    (threadId: string) => {
      if (asked.current.has(threadId)) {
        return
      }
      read(threadId)
    },
    [read],
  )

  const retrySelectors = useCallback(
    (threadId: string) => {
      setSelectorFailure((held) =>
        Object.fromEntries(Object.entries(held).filter(([id]) => id !== threadId)),
      )
      read(threadId)
    },
    [read],
  )

  const selectControl = useCallback(
    (threadId: string, controlId: string, value: string) => {
      if (config === undefined) {
        return
      }
      config
        .select(threadId, controlId, value)
        .then((offered) => {
          remember(threadId, offered)
        })
        .catch((reason: unknown) => {
          noteSelectorFailure(threadId, reason)
        })
    },
    [config, noteSelectorFailure, remember],
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
    selectorsOf,
    selectorFailureOf,
    adopt,
    retrySelectors,
    selectControl,
    refresh,
    isLoading,
    failure,
  }
}
