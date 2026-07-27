import { useCallback, useEffect, useState } from 'react'

import type { AgentModelsPort } from '../contracts/model-port'
import type { SessionConfigControl } from '../contracts/session-config-contract'
import type { SessionConfigPort } from '../contracts/session-config-port'

/*
 * One list, one loader, one failure.
 *
 * The selectors belong to the running session; before the first turn there is
 * no session, and the agent config file is the only thing that names a model.
 * Both arrive as SessionConfigControl, so the surface never has to know which
 * one answered, and there is no second hook duplicating this loader.
 *
 * Nothing is updated optimistically: what the control shows after a switch is
 * what came back from that switch, because the agent obeys the source, not us.
 */

const NONE: readonly SessionConfigControl[] = []

const MODEL_CONTROL_ID = 'agent-config:model'

const FAILURE_FALLBACK = '读取会话设置失败。'

function describe(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) return cause.message
  if (typeof cause === 'string' && cause.length > 0) return cause

  return FAILURE_FALLBACK
}

export interface SessionControlSelection {
  readonly controls: readonly SessionConfigControl[]
  readonly select: (controlId: string, value: string) => void
  readonly failure: string | undefined
}

export function useSessionControls(
  config?: SessionConfigPort,
  models?: AgentModelsPort,
  /** Changes when the run does, which is when the session may have changed. */
  sessionGeneration?: string | number,
): SessionControlSelection {
  const [controls, setControls] = useState<readonly SessionConfigControl[]>(NONE)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const load = useCallback(async (): Promise<readonly SessionConfigControl[]> => {
    const reported = config === undefined ? NONE : await config.list()

    if (reported.length > 0 || models === undefined) return reported

    const selection = await models.list()

    if (selection.models.length === 0) return NONE

    return [
      {
        id: MODEL_CONTROL_ID,
        label: '模型',
        purpose: 'model',
        current: selection.activeModelId ?? selection.models[0].id,
        choices: selection.models.map((model) => ({ value: model.id, label: model.label })),
      },
    ]
  }, [config, models])

  useEffect(() => {
    let cancelled = false

    load()
      .then((next) => {
        if (!cancelled) setControls(next)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setFailure(describe(cause))
      })

    return () => {
      cancelled = true
    }
  }, [load, sessionGeneration])

  const select = useCallback(
    (controlId: string, value: string) => {
      setFailure(undefined)

      const write =
        controlId === MODEL_CONTROL_ID
          ? models?.select(value).then(() => load())
          : config?.select(controlId, value)

      write
        ?.then((next) => {
          setControls(next)
        })
        .catch((cause: unknown) => {
          setFailure(describe(cause))
        })
    },
    [config, load, models],
  )

  return { controls, select, failure }
}
