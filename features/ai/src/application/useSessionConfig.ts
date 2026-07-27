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
 * The generation token exists because a session is not there from the start. The
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
  sessionGeneration?: string | number,
): SessionConfigSelection {
  const [controls, setControls] = useState<readonly SessionConfigControl[]>(NONE)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  /*
   * sessionGeneration 不在 effect 体内被读取，所以 biome 判它多余，并且给出
   * 一个一键删除的 Unsafe fix。不能接受那个修复。
   *
   * 选择器属于会话，而第一轮之前会话并不存在，此时 list() 只能返回空数组。
   * 这个参数是唯一让列表在会话换代后被重新读取的东西。删掉它之后列表会在
   * 整轮里一直为空，而空列表按 SessionConfigPort 的约定恰好表示"还没有会话
   * 在跑"——坏掉的样子和正常的样子完全相同，不报错也没有检查会失败。
   *
   * 旁边的 useAgentModels 有逐字相同的 effect 体、却只依赖 [port]，这会让
   * 对比两个文件的人误以为这里是手误。留下这段说明就是为了挡住那个结论。
   *
   * biome-ignore lint/correctness/useExhaustiveDependencies: 有意的额外依赖，
   * 会话换代后必须重新读取选择器；删掉它会让列表在整轮里静默保持为空。
   */
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
  }, [sessionGeneration, port])

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
