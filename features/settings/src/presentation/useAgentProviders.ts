import {
  AGENT_PROVIDER_LIST_ARGS,
  type AgentProviderSnapshot,
  parseAgentProviderListOutput,
} from '@poietica/agent-registry'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentConfigStore } from '../ports/agent-config-store'

/**
 * 向 agent 问一次「你配了哪些 provider、哪些模型」。
 *
 * 产地只有一个：agent 官方 CLI 的 provider list --json。我们这边不存目录、不存
 * 模型清单、不存密钥，所以这份状态每次都是问出来的，不是读出来的 —— 也因此它
 * 永远不会与 agent 的实际配置不一致。
 *
 * 「当前选中哪个模型」不在这里。那个要问 ACP 会话的 configOptions：它是会话级
 * 的，而且只有活着的会话才知道。两件事分属两条管线，合并会让其中一条撒谎。
 */
export interface AgentProvidersState {
  readonly loading: boolean
  readonly snapshot: AgentProviderSnapshot | undefined
  readonly error: string | null
  readonly reload: () => void
}

export function useAgentProviders(store: AgentConfigStore, agentId: string): AgentProvidersState {
  const [loading, setLoading] = useState(true)
  const [snapshot, setSnapshot] = useState<AgentProviderSnapshot | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  /*
   * 每次询问领一个号，只有最新的号有权写状态。
   *
   * 上一版拿一个 attempt 计数器当重跑开关，又把它写进依赖数组 —— 那是 effect
   * 里根本没用到的值。把请求本身提成回调之后，effect 依赖这个回调就够了，刷新
   * 也只是再调一次同一个回调，不需要一个假依赖。
   *
   * 号顺便顶掉了 active 标志：卸载时递增一次，在飞的那次自然作废。
   */
  const generation = useRef(0)

  const ask = useCallback(() => {
    generation.current += 1

    const mine = generation.current
    const stale = () => mine !== generation.current

    setLoading(true)
    setError(null)

    void store
      .execCli({
        agentId,
        args: AGENT_PROVIDER_LIST_ARGS,
        secretVar: '',
        secretValue: '',
      })
      .then(
        (outcome) => {
          if (stale()) {
            return
          }

          setLoading(false)

          /*
           * 非零退出时把 agent 自己的 stderr 直接给用户看。config.toml 坏了的
           * 时候它说得比我们清楚 —— 连怎么修都告诉你 —— 转述一遍只会丢信息。
           */
          if (outcome.status !== 0) {
            setSnapshot(undefined)
            setError(describeExit(outcome.status, outcome.stderr))
            return
          }

          setSnapshot(parseAgentProviderListOutput(outcome.stdout))
        },
        (cause: unknown) => {
          if (stale()) {
            return
          }

          setLoading(false)
          setSnapshot(undefined)
          setError(cause instanceof Error ? cause.message : '无法向 agent 询问模型清单。')
        },
      )
  }, [agentId, store])

  useEffect(() => {
    ask()

    return () => {
      generation.current += 1
    }
  }, [ask])

  return { loading, snapshot, error, reload: ask }
}

function describeExit(status: number, stderr: string): string {
  const detail = stderr.trim()

  return detail.length > 0 ? detail : `agent 以退出码 ${status} 结束，且没有说明原因。`
}
