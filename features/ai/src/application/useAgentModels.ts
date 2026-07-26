import { useCallback, useEffect, useState } from 'react'

import type { AgentModel } from '../contracts/model-contract'
import type { AgentModelSelection, AgentModelsPort } from '../contracts/model-port'

/*
 * The list is read, never assumed.
 *
 * A switch is a write to the file the agent reads, so what the picker shows
 * afterwards is what came back from that write. Updating optimistically would
 * let the control disagree with the file, and the file is the one the agent
 * obeys.
 *
 * With no port there is no list, and with no list the picker draws nothing.
 * That is the honest state for fixtures and for component work.
 */

const NONE: readonly AgentModel[] = []

const FAILURE_FALLBACK = '读取助手的模型列表失败。'

export interface AgentModelChoice {
  readonly models: readonly AgentModel[]
  readonly activeModelId: string | undefined
  readonly select: (modelId: string) => void
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

export function useAgentModels(port?: AgentModelsPort): AgentModelChoice {
  const [selection, setSelection] = useState<AgentModelSelection | undefined>(undefined)
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
          setSelection(next)
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
  }, [port])

  const select = useCallback(
    (modelId: string) => {
      if (!port) {
        return
      }

      setFailure(undefined)

      port
        .select(modelId)
        .then((next) => {
          setSelection(next)
        })
        .catch((cause: unknown) => {
          setFailure(describe(cause))
        })
    },
    [port],
  )

  return {
    models: selection?.models ?? NONE,
    activeModelId: selection?.activeModelId,
    select,
    failure,
  }
}
