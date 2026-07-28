import type {
  AgentSessionPort,
  ChatStatus,
  RunEvent,
  TimelineState,
} from '@poietica/agent-protocol'
import {
  appendUserMessage,
  applyRunEvent,
  createTimelineState,
  replayThreadEvents,
} from '@poietica/agent-timeline'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/*
 * The surface depends on the agent session PORT, never on a protocol client.
 *
 * The port is implemented in Rust behind typed IPC: it owns the ACP client, the
 * agent subprocess and every credential. Rendering the AI surface must not
 * require any of that to exist, so the default is an inert stub and the UI stays
 * fully developable against recorded fixtures.
 *
 * What the user said is not part of that arrangement. It is committed locally
 * and shown immediately; the run that follows is a segment appended to the same
 * transcript. A turn that fails therefore loses its answer, never the question,
 * and a second turn is added to the conversation instead of replacing it.
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
  /** True while a conversation is still being read out of the log. */
  readonly isRestoring: boolean
}

const RUN_PLACEHOLDER = 'run_pending'

/*
 * What has already been read out of the log, per conversation.
 *
 * Frames are immutable history, so coming back to a conversation must not
 * go blank and then fill in: the snapshot from the last read is shown in
 * the same commit as the switch, and the fresh read replaces it silently
 * when it lands. Module scope, so it outlives a surface unmounted with its
 * tab.
 */
const restored = new Map<string, readonly RunEvent[]>()

/*
 * What the user is told when a run never started.
 *
 * The native side keeps its own detail on its own side of the wire, so this is
 * a fallback for a rejection that carries no message at all.
 */
const FAILURE_FALLBACK = '助手无法启动，或与它的连接已中断。'

/*
 * A surface with no port is a composition mistake, not a mode of operation.
 * Swallowing the submission would make the message vanish with no explanation,
 * which is exactly the failure this round exists to remove.
 */
const NO_SESSION = '这个界面还没有接上助手会话，消息没有发送出去。'

/*
 * 开一条对话失败了，所以这一句没有地方可去。
 *
 * 入口那一格在第一句话时才向平台要一条对话；要不到就不能假装要到了，
 * 更不能发往一个占位的名字。
 */
const NO_THREAD = '无法开始新的对话，消息没有发送出去。'

function describeFailure(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message
  }
  if (typeof cause === 'string' && cause.length > 0) {
    return cause
  }
  return FAILURE_FALLBACK
}

export function useAssistantSession({
  endpoint,
  identify,
  onUserMessage,
  session,
}: AssistantSessionOptions): AssistantSession {
  const [timeline, setTimeline] = useState<TimelineState>(() => opening(endpoint))
  const [shown, setShown] = useState(endpoint)
  const [isRestoring, setIsRestoring] = useState(() => endpoint !== null && !restored.has(endpoint))
  const cancelRef = useRef<(() => Promise<void>) | undefined>(undefined)

  /*
   * The conversation on screen changes during render, not a paint later.
   *
   * Adjusting state while rendering is the answer React itself gives for
   * state derived from a prop. The alternative is an effect, and an effect
   * runs after the browser has already painted the conversation the user
   * left under the tab of the one they chose. That paint is the flicker,
   * and no amount of easing hides it.
   */
  if (shown !== endpoint) {
    /*
     * 认领身份不是换对话。
     *
     * 入口那一格说出第一句之后才知道自己是哪条对话，而那句话此刻已经在
     * 屏幕上了；把这当成一次切换会把它连同已经流进来的回答一起擦掉。
     * 真正的切换是从一条已知对话走到另一条。
     */
    const claiming = shown === null

    setShown(endpoint)

    if (!claiming) {
      setTimeline(opening(endpoint))
      setIsRestoring(endpoint !== null && !restored.has(endpoint))
    }
  }

  useEffect(() => {
    if (!session) {
      return undefined
    }
    return session.subscribe((event: RunEvent) => {
      setTimeline((current) => applyRunEvent(current, event))
    })
  }, [session])

  /*
   * A failure the log never saw.
   *
   * Spawning the agent, or answering a question it no longer waits for, fails
   * before anything durable exists, so there is no frame to replay. The reducer
   * already knows how to render a failed run, so the fact is handed to it as
   * the run_failed event it is rather than by reaching into the state shape.
   */
  const fail = useCallback((cause: unknown) => {
    setTimeline((current) =>
      applyRunEvent(current, {
        kind: 'run_failed',
        seq: current.lastSeq + 1,
        at: Date.now(),
        message: describeFailure(cause),
      }),
    )
  }, [])

  /*
   * Switching conversation is reading one.
   *
   * The transcript on screen belongs to a conversation, so a different
   * endpoint means a different conversation has to be read out of the log
   * rather than an empty one shown. The frames are the ones that were
   * broadcast while each turn was live, so reopening a conversation cannot
   * disagree with having watched it.
   *
   * An answer that arrives after the endpoint moved on is dropped: it
   * belongs to the conversation the user has already left.
   */
  useEffect(() => {
    if (endpoint === null || session?.loadThread === undefined) {
      setIsRestoring(false)

      return undefined
    }

    let current = true

    void session
      .loadThread(endpoint)
      .then((events) => {
        restored.set(endpoint, events)

        if (current) {
          setTimeline(replayThreadEvents(RUN_PLACEHOLDER, events))
          setIsRestoring(false)
        }
      })
      .catch((cause: unknown) => {
        if (current) {
          setIsRestoring(false)
          fail(cause)
        }
      })

    return () => {
      current = false
    }
  }, [endpoint, fail, session])

  const send = useCallback(
    (submission: AssistantSubmission) => {
      const at = Date.now()

      /* The question is on screen before anything is asked of the agent. */
      setTimeline((current) => appendUserMessage(current, submission.text, at))

      if (!session) {
        fail(new Error(NO_SESSION))

        return
      }

      /*
       * 先有身份，再有这一轮。
       *
       * 入口那一格在这一刻才成为一条对话，所以名字、标签和 prompt 拿到的
       * 是同一个真 id。此前它在挂载时就预支一个占位 id：抢在会话开出来之前
       * 发出的第一句，会在列表里留下一条永远无人认领的记录，把标签开在一条
       * 不存在的对话上，并在真 id 到达时被从屏幕上清空。
       */
      const conversation =
        endpoint === null ? (identify?.() ?? Promise.resolve(null)) : Promise.resolve(endpoint)

      void conversation
        .then((threadId) => {
          if (threadId === null) {
            fail(new Error(NO_THREAD))

            return undefined
          }

          /* The list names a conversation from this, which is why it leaves
             before the turn does: a turn that fails was still asked. */
          onUserMessage?.(threadId, submission.text)

          return session.prompt({ threadId, text: submission.text }).then((handle) => {
            cancelRef.current = handle.cancel

            /* The turn now has a real identity, which is what replaying it from
               the log will need. */
            setTimeline((current) =>
              current.runId === handle.runId ? current : { ...current, runId: handle.runId },
            )
          })
        })
        .catch((cause: unknown) => {
          fail(cause)
        })
    },
    [endpoint, fail, identify, onUserMessage, session],
  )

  const cancel = useCallback(() => {
    void cancelRef.current?.()
  }, [])

  /*
   * The answer is not applied locally. The native side records it and emits
   * permission_resolved, which the reducer applies like any other event, so a
   * replayed run and a live run agree.
   *
   * A rejected call means the agent never heard the answer and the turn cannot
   * continue, which is a failed run rather than a silent stall.
   */
  const resolvePermission = useCallback(
    (requestId: string, optionId: string) => {
      if (!session) {
        return
      }

      session.resolvePermission(requestId, optionId).catch((cause: unknown) => {
        fail(cause)
      })
    },
    [fail, session],
  )

  const status = useMemo<ChatStatus>(() => toChatStatus(timeline.status), [timeline.status])

  return {
    status,
    timeline,
    send,
    cancel,
    resolvePermission,
    isRestoring,
  }
}

/** The transcript a conversation opens with: its last read, or an empty one. */
function opening(threadId: string | null): TimelineState {
  const held = threadId === null ? undefined : restored.get(threadId)

  return held === undefined
    ? createTimelineState(RUN_PLACEHOLDER)
    : replayThreadEvents(RUN_PLACEHOLDER, held)
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
