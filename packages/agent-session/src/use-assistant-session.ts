import type { AgentSessionPort, ChatStatus } from '@poietica/acp'
import type { TimelineState } from '@poietica/agent-timeline'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { transcripts } from './transcript-store'

/*
 * 这个 Hook 只做一件事：把 store 里属于这一格的那一条读出来。
 *
 * 它此前是一个组件级的数据层：转录的副本活在 useState 里（每个挂载的界面一
 * 份），旁边配着一个模块级 LRU、一个分页游标、一个代际号做的竞态守卫、一个
 * ref 做的乐观 id 对账、一处渲染期改 state 的修补，以及每个界面各订阅一次的
 * 全量帧流。那六件事全部属于 store，现在也全部在 store 里 —— 见
 * ./transcript-store.ts。
 *
 * 对外的三个类型和 useAssistantSession 的签名一字未变，所以上层不用改。
 */

export interface AssistantSubmission {
  readonly text: string
  readonly files: readonly File[]
}

export interface AssistantSessionOptions {
  /**
   * Thread this surface is bound to, or null before it has become one.
   *
   * 入口那一格还不是任何一条对话：没有可回放的记录，也没有名字。
   */
  readonly endpoint: string | null
  /**
   * Acquires the conversation this surface is about to become.
   *
   * 只在第一句话时问一次。要不到就没有地方可送，这一句因此失败，
   * 而不是发往一个不存在的对话。
   */
  readonly identify?: (() => Promise<string | null>) | undefined
  /**
   * What the user just said, before the agent is asked anything.
   *
   * The conversation list names a conversation from its first message,
   * and the list is not this hook to keep, so the fact is handed out
   * rather than reached for.
   */
  readonly onUserMessage?: ((threadId: string, text: string) => void) | undefined
  readonly session?: AgentSessionPort | undefined
}

export interface AssistantSession {
  readonly status: ChatStatus
  readonly timeline: TimelineState
  readonly send: (submission: AssistantSubmission) => void
  readonly cancel: () => void
  readonly resolvePermission: (requestId: string, optionId: string) => void
  /** True while a conversation is still being fetched. */
  readonly isRestoring: boolean
}

export function useAssistantSession({
  endpoint,
  identify,
  onUserMessage,
  session,
}: AssistantSessionOptions): AssistantSession {
  /*
   * 入口那一格也需要一个键。
   *
   * 它还不是任何一条对话，可它已经有转录了 —— 人说的那句话。给它一个草稿键，
   * 真 id 到达时由 store 改名，两个键读到同一份东西。此前这件事是一个 ref
   * （claimed）加一处渲染期的 setState 在做。
   */
  const [draft] = useState(transcripts.newDraft)

  const key = endpoint ?? draft

  const transcript = useSyncExternalStore(
    useCallback((onChange: () => void) => transcripts.subscribe(key, onChange), [key]),
    useCallback(() => transcripts.read(key), [key]),
  )

  /*
   * 接上帧流。就这一件事。
   *
   * 这里此前还负责"打开一条对话就把它取回来"。历史现在随打开那条对话一起回来
   * （见 ThreadsStore 与 agent_open_thread），取过没有、要不要重取、晚到的算不
   * 算，这几个问题连同那条取数路径一起没有了。
   *
   * 条件因此只剩线路：接不接得上帧流，与这一格现在看着哪条对话无关。入口那一
   * 格也接 —— 它在说第一句话之前就该听着了，此前要等它变成一条真对话，靠 send
   * 里那次 attach 补救才没漏帧。
   */
  useEffect(() => {
    if (session === undefined) {
      return
    }

    transcripts.ensure(session)
  }, [session])

  const send = useCallback(
    (submission: AssistantSubmission) => {
      transcripts.send({
        endpoint,
        identify,
        key,
        onUserMessage,
        port: session,
        text: submission.text,
      })
    },
    [endpoint, identify, key, onUserMessage, session],
  )

  const cancel = useCallback(() => {
    transcripts.cancel(key)
  }, [key])

  const resolvePermission = useCallback(
    (requestId: string, optionId: string) => {
      transcripts.resolvePermission(key, requestId, optionId)
    },
    [key],
  )

  /* 纯 switch,返回字符串字面量:依赖数组的分配与比较比它本身贵。 */
  const status = toChatStatus(transcript.timeline.status)

  return {
    status,
    timeline: transcript.timeline,
    send,
    cancel,
    resolvePermission,
    isRestoring: transcript.restoring,
  }
}

function toChatStatus(status: TimelineState['status']): ChatStatus {
  switch (status) {
    case 'running':
    case 'awaiting_permission':
      return 'streaming'
    case 'failed':
      return 'error'
    default:
      return 'ready'
  }
}
