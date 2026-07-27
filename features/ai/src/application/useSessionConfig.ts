import { useCallback, useEffect, useState } from 'react'

import type { SessionConfigControl } from '../contracts/session-config-contract'
import type { SessionConfigPort } from '../contracts/session-config-port'

/*
 * The selectors are asked for, never assumed.
 *
 * What the menu shows after a switch is what came back from that switch.
 * Updating optimistically would let the control disagree with the session,
 * and the session is the one the agent obeys.
 *
 * The epoch exists because a session is not there from the start. The
 * surface hands over something that changes when the run does, and the list
 * is read again against the session that exists by then. Without a port
 * there are no selectors, which is the honest state for fixtures.
 */

const NONE: readonly SessionConfigControl[] = []

const FAILURE_FALLBACK = '读取会话设置失败。'

export interface SessionConfigSelection {
  readonly controls: readonly SessionConfigControl[]
  readonly select: (configId: string, value: string) => void
  readonly failure: string | undefined
}

function describe(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message
  }

  if (typeof cause === 'string' && cause.length > 0) {
    return cause
  }

  return FAILURE_FALLBACK
}

export function useSessionConfig(
  port?: SessionConfigPort,
  epoch?: unknown,
): SessionConfigSelection {
  const [controls, setControls] = useState<readonly SessionConfigControl[]>(NONE)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!port) {
      return undefined
    }

    let cancelled = false

    port
      .list()
      .then((next) => {
        if (!cancelled) {
          setControls(next)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setFailure(describe(cause))
        }
      })

    return () => {
      cancelled = true
    }
  }, [epoch, port])

  const select = useCallback(
    (configId: string, value: string) => {
      if (!port) {
        return
      }

      setFailure(undefined)

      port
        .select(configId, value)
        .then((next) => {
          setControls(next)
        })
        .catch((cause: unknown) => {
          setFailure(describe(cause))
        })
    },
    [port],
  )

  return { controls, select, failure }
}
