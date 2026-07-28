import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AgentSessionPort } from '../contracts/agent-session-port'
import type { ChatStatus } from '../contracts/chat-status-contract'
import type { RunEvent } from '../contracts/run-contract'
import type { TimelineState } from '../contracts/timeline-contract'
import {
  appendUserMessage,
  applyRunEvent,
  createTimelineState,
  replayThreadEvents,
} from '../domain/timeline-reducer'

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
  /** Thread this surface is bound to. */
  readonly endpoint: string
  /**
   * What the user just said, before the agent is asked anything.
   *
   * The conversation list names a conversation from its first message,
   * and the list is not this hook to keep, so the fact is handed out
   * rather than reached for.
   */
  readonly onUserMessage?: (text: string) => void
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
  onUserMessage,
  session,
}: AssistantSessionOptions): AssistantSession {
  const [timeline, setTimeline] = useState<TimelineState>(() => opening(endpoint))
  const [shown, setShown] = useState(endpoint)
  const [isRestoring, setIsRestoring] = useState(() => !restored.has(endpoint))
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
    setShown(endpoint)
    setTimeline(opening(endpoint))
    setIsRestoring(!restored.has(endpoint))
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
    if (session?.loadThread === undefined) {
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

      /* The list names a conversation from this, which is why it leaves
         before the turn does: a turn that fails was still asked. */
      onUserMessage?.(submission.text)

      if (!session) {
        fail(new Error(NO_SESSION))

        return
      }

      session
        .prompt({ threadId: endpoint, text: submission.text })
        .then((handle) => {
          cancelRef.current = handle.cancel

          /* The turn now has a real identity, which is what replaying it from
             the log will need. */
          setTimeline((current) =>
            current.runId === handle.runId ? current : { ...current, runId: handle.runId },
          )
        })
        .catch((cause: unknown) => {
          fail(cause)
        })
    },
    [endpoint, fail, onUserMessage, session],
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
function opening(threadId: string): TimelineState {
  const held = restored.get(threadId)

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
