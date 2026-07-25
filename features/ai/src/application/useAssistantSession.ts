import { useCallback, useMemo, useState } from 'react'

import type { ChatStatus } from '../presentation/ai-elements/prompt-input'

/*
 * The surface depends on the transport PORT, never on a concrete SDK.
 *
 * Rendering the AI surface must not require ai / @ai-sdk/react to be
 * installed or an endpoint to be reachable. The ai-sdk adapter
 * (adapters/ai-sdk-transport.ts) is wired in during P2 by passing a
 * transport here; until then the default stub keeps the UI fully usable.
 */

export interface AssistantSubmission {
  readonly text: string
  readonly files: readonly File[]
}

export interface AssistantTransportPort {
  readonly send: (submission: AssistantSubmission) => Promise<void>
}

export interface AssistantSessionOptions {
  readonly endpoint: string
  readonly transport?: AssistantTransportPort
}

export interface AssistantSession {
  readonly status: ChatStatus
  readonly send: (submission: AssistantSubmission) => void
}

export function useAssistantSession({
  endpoint,
  transport,
}: AssistantSessionOptions): AssistantSession {
  const [status, setStatus] = useState<ChatStatus>('ready')

  const resolved = useMemo<AssistantTransportPort>(
    () =>
      transport ?? {
        send: async () => {
          /* P2: replaced by createAiSdkTransport({ endpoint }) */
          void endpoint
          await Promise.resolve()
        },
      },
    [endpoint, transport],
  )

  const send = useCallback(
    (submission: AssistantSubmission) => {
      setStatus('submitted')

      resolved.send(submission).then(
        () => {
          setStatus('ready')
        },
        () => {
          setStatus('error')
        },
      )
    },
    [resolved],
  )

  return { status, send }
}
