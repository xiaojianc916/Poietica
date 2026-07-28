import { useCallback, useEffect, useState } from 'react'

import type { SessionConfigControl } from '../contracts/session-config-contract'
import type { SessionConfigPort } from '../contracts/session-config-port'

/*
 * 选择器只有一个来源：正在跑的会话。
 *
 * 读这份列表就是开这个会话，所以第一次读失败等于整个功能不可用。它必须能
 * 说出自己失败了，也必须能被重试：此前失败只写进一个 title 提示，界面上
 * 剩下的是一句「会话未就绪」和一个不可点击的元素，三个选择器一起变成死的。
 *
 * 这里不发明任何一个选项，也不为某一类单独开一条读路径。
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
  /** 再问一次。第一次问就是开会话，所以这也是重新开会话的那一下。 */
  readonly retry: () => void
}

export function useSessionControls(
  config?: SessionConfigPort,
  /** 屏幕上的这场对话。换一场就是换一个会话，也就换一套选择器。 */
  sessionGeneration?: string | number,
): SessionControlSelection {
  const [controls, setControls] = useState<readonly SessionConfigControl[]>(NONE)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (config === undefined) {
      return undefined
    }

    let cancelled = false

    /* 两者都是重读的理由，在这里被读到，于是它们是本效应的依赖。 */
    void sessionGeneration
    void attempt

    config
      .list()
      .then((next) => {
        if (!cancelled) {
          setControls(next)
          /* 读成功了，上一次的失败就不再成立。 */
          setFailure(undefined)
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
  }, [attempt, config, sessionGeneration])

  const retry = useCallback(() => {
    setFailure(undefined)
    setAttempt((count) => count + 1)
  }, [])

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

  return { controls, failure, retry, select }
}
