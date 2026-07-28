import type { SessionConfigControl, SessionConfigPort } from '@poietica/agent-protocol'
import { useCallback, useEffect, useState } from 'react'

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
  /**
   * 屏幕上的这场对话。
   *
   * 它既是重读的理由，也是问句本身。此前这里叫 sessionGeneration，
   * 注释写着它是对话，代码里却只 void 一下当变化标记用，真正问出去
   * 的是一句没有主语的话——于是无论屏幕上是哪一条，答的都是连接第
   * 一条会话的那一份。
   */
  threadId?: string | null,
): SessionControlSelection {
  const [controls, setControls] = useState<readonly SessionConfigControl[]>(NONE)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (config === undefined) {
      return undefined
    }

    let cancelled = false

    /* 重试是重读的理由，但它不进入问句，所以只在这里被读到。 */
    void attempt

    config
      .list(threadId ?? null)
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
  }, [attempt, config, threadId])

  const retry = useCallback(() => {
    setFailure(undefined)
    setAttempt((count) => count + 1)
  }, [])

  const select = useCallback(
    (controlId: string, value: string) => {
      setFailure(undefined)

      config
        ?.select(threadId ?? null, controlId, value)
        .then((next) => {
          setControls(next)
        })
        .catch((cause: unknown) => {
          setFailure(describe(cause))
        })
    },
    [config, threadId],
  )

  return { controls, failure, retry, select }
}
