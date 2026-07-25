import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AgentSessionPort } from '../contracts/agent-session-port'
import type { RunEvent } from '../contracts/run-contract'
import type { TimelineState } from '../contracts/timeline-contract'
import { applyRunEvent, createTimelineState } from '../domain/timeline-reducer'
import type { ChatStatus } from '../presentation/ai-elements/prompt-input'

/*
 * The surface depends on the agent session PORT, never on a protocol client.
 *
 * The port is implemented in Rust behind typed IPC: it owns the ACP client, the
 * agent subprocess and every credential. Rendering the AI surface must not
 * require any of that to exist, so the default is an inert stub and the UI stays
 * fully developable against recorded fixtures.
 */

export interface AssistantSubmission {
  readonly text: string
  readonly files: readonly File[]
}

export interface AssistantSessionOptions {
  /** Thread this surface is bound to. */
  readonly endpoint: string
  readonly session?: AgentSessionPort
}

export interface AssistantSession {
  readonly status: ChatStatus
  readonly timeline: TimelineState
  readonly send: (submission: AssistantSubmission) => void
  readonly cancel: () => void
}

const RUN_PLACEHOLDER = 'run_pending'

export function useAssistantSession({
  endpoint,
  session,
}: AssistantSessionOptions): AssistantSession {
  const [timeline, setTimeline] = useState<TimelineState>(() =>
    createTimelineState(RUN_PLACEHOLDER),
  )
  const cancelRef = useRef<(() => Promise<void>) | undefined>(undefined)

  useEffect(() => {
    if (!session) return undefined
    return session.subscribe((event: RunEvent) => {
      setTimeline((current) => applyRunEvent(current, event))
    })
  }, [session])

  const send = useCallback(
    (submission: AssistantSubmission) => {
      if (!session) return

      setTimeline(createTimelineState(RUN_PLACEHOLDER))

      session
        .prompt({ threadId: endpoint, text: submission.text })
        .then((handle) => {
          cancelRef.current = handle.cancel
        })
        .catch(() => {
          setTimeline((current) => ({ ...current, status: 'failed' }))
        })
    },
    [endpoint, session],
  )

  const cancel = useCallback(() => {
    void cancelRef.current?.()
  }, [])

  const status = useMemo<ChatStatus>(() => toChatStatus(timeline.status), [timeline.status])

  return { status, timeline, send, cancel }
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
