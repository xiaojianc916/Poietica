import { useCallback, useEffect, useState } from 'react'

import type { SessionConfigControl } from '../contracts/session-config-contract'
import type { SessionConfigPort } from '../contracts/session-config-port'

/*
 * 选择器只有一个来源：正在跑的会话。
 *
 * 模型、思考档位和模式都是 agent 自己报出来的，这里不发明任何一个，也不为
 * 某一类单独开一条写路径。切换之后显示什么，就是那次切换带回来的东西 ——
 * agent 听的是它自己，不是我们。
 */

const NONE: readonly SessionConfigControl[] = []

const FAILURE_FALLBACK = '读取会话设置失败。'

function describe(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message
  }

  if (typeof cause === 'string' && cause.length > 0) {
    return cause
  }

  return FAILURE_FALLBACK
}

export interface SessionControlSelection {
  readonly controls: readonly SessionConfigControl[]
  readonly select: (controlId: string, value: string) => void
  readonly failure: string | undefined
}

export function useSessionControls(
  config?: SessionConfigPort,
  /** Changes when the run does, which is when the session may have changed. */
  sessionGeneration?: string | number,
): SessionControlSelection {
  const [controls, setControls] = useState<readonly SessionConfigControl[]>(NONE)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const load = useCallback(async (): Promise<readonly SessionConfigControl[]> => {
    /* 换一代会话就重读一次；代号在这里被捕获，于是它是 load 自己的依赖。 */
    void sessionGeneration

    return config === undefined ? NONE : await config.list()
  }, [config, sessionGeneration])

  useEffect(() => {
    let cancelled = false

    load()
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
  }, [load])

  const select = useCallback(
    (controlId: string, value: string) => {
      setFailure(undefined)

      config
        ?.select(controlId, value)
        .then((next) => {
          setControls(next)
        })
        .catch((cause: unknown) => {
          setFailure(describe(cause))
        })
    },
    [config],
  )

  return { controls, select, failure }
}
