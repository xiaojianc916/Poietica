import {
  AGENT_PROVIDER_LIST,
  type AgentProviderSnapshot,
  parseAgentProviderListOutput,
} from '@poietica/agent-registry'
import { useCallback, useEffect, useState } from 'react'
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
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => {
    setAttempt((current) => current + 1)
  }, [])

  /*
   * agentId 变了就重问一遍：两个 agent 的 provider 各自独立，沿用上一个的清单
   * 会让界面显示一份属于别人的配置。
   *
   * active 标志防两件事：切走设置页时调用才回来，以及连点刷新时旧的一次覆盖
   * 新的一次。
   */
  useEffect(() => {
    let active = true

    setLoading(true)
    setError(null)

    void store
      .execCli({
        agentId,
        command: AGENT_PROVIDER_LIST.command,
        args: AGENT_PROVIDER_LIST.args,
        secretVar: '',
        secretValue: '',
      })
      .then(
        (outcome) => {
          if (!active) {
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
          if (!active) {
            return
          }

          setLoading(false)
          setSnapshot(undefined)
          setError(cause instanceof Error ? cause.message : '无法向 agent 询问模型清单。')
        },
      )

    return () => {
      active = false
    }
  }, [agentId, attempt, store])

  return { loading, snapshot, error, reload }
}

function describeExit(status: number, stderr: string): string {
  const detail = stderr.trim()

  return detail.length > 0 ? detail : `agent 以退出码 ${status} 结束，且没有说明原因。`
}
