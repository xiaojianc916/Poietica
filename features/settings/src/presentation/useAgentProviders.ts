import {
  type AgentProviderSnapshot,
  acpAgentById,
  parseAgentProviderListOutput,
} from '@poietica/agent-registry'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentConfigStore } from '../ports/agent-config-store'
import { describeAgentCliExit, describeAgentCliFailure } from './agentCliText'

/*
 * 向 agent 问一次「你配了哪些 provider、哪些模型」。
 *
 * 产地只有一个：agent 官方 CLI 的 provider list --json。权威永远是 agent 的配置
 * 文件，这里不存第二份 —— 内存里这份缓存只是展示层的 stale-while-revalidate：
 * 重新进入这一页时先摆上一次的快照，后台这一次往返回来后再换。它随进程退出
 * 消失，从来不是「真相」，所以不需要失效逻辑 —— 每次挂载都会真问一次。
 *
 * 缓存按 agentId 分键：换 agent 时看到的是它自己的上一份，不是上一家 agent 的。
 *
 * 「当前选中哪个模型」不在这里。那个要问 ACP 会话的 configOptions：它是会话级
 * 的，而且只有活着的会话才知道。两件事分属两条管线，合并会让其中一条撒谎。
 */
const lastGood = new Map<string, AgentProviderSnapshot>()

export interface AgentProvidersState {
  readonly loading: boolean
  readonly snapshot: AgentProviderSnapshot | undefined
  readonly error: string | null
  readonly reload: () => void
}

export function useAgentProviders(store: AgentConfigStore, agentId: string): AgentProvidersState {
  const [loading, setLoading] = useState(() => !lastGood.has(agentId))
  const [snapshot, setSnapshot] = useState<AgentProviderSnapshot | undefined>(() =>
    lastGood.get(agentId),
  )
  const [error, setError] = useState<string | null>(null)

  /*
   * 每次询问领一个号，只有最新的号有权写状态。卸载时递增一次，在飞的那次自然作废。
   */
  const generation = useRef(0)

  const ask = useCallback(() => {
    generation.current += 1

    const mine = generation.current
    const stale = () => mine !== generation.current

    /*
     * 问什么、以及哪个 id 是环境变量合成的保留条目，都写在 agent 的档案里。
     * 这一层不认识任何一家 —— 与 agent-provider-state 里那句是同一个理由。
     */
    const descriptor = acpAgentById(agentId)

    if (descriptor === undefined) {
      setLoading(false)
      setSnapshot(undefined)
      setError(`没有登记 ${agentId} 这个 agent 的接入档案。`)

      return
    }

    /*
     * 这一家有没有这种查询，档案说了算 —— 契约里 providerListArgs 是可选的，
     * 缺席就是「问不了」，不是「随便发一条命令试试」。
     */
    const listArgs = descriptor.providerListArgs

    if (listArgs === undefined) {
      setLoading(false)
      setSnapshot(undefined)
      setError(`${descriptor.displayName} 没有声明查询模型清单的子命令。`)

      return
    }

    /*
     * 有缓存先摆缓存，后台再真问 —— 重新进入不再每次空等一次进程启动。
     * 没有缓存才进 loading：那是唯一一次「什么都还拿不出来」的等待。
     */
    const cached = lastGood.get(agentId)

    if (cached !== undefined) {
      setSnapshot(cached)
    } else {
      setSnapshot(undefined)
      setLoading(true)
    }

    setError(null)

    void store
      .execCli({
        agentId,
        args: [...listArgs],
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
           *
           * 有缓存时后台这次失败不换掉列表：上一快照仍是 agent 片刻前的真实
           * 配置，下一次进入或手动刷新会重试。没有缓存才把错误摆到列表的位置。
           */
          if (outcome.status !== 0) {
            if (cached === undefined) {
              setSnapshot(undefined)
              setError(describeAgentCliExit(outcome.status, outcome.stderr))
            }

            return
          }

          const next = parseAgentProviderListOutput(outcome.stdout, descriptor.syntheticProviderId)

          lastGood.set(agentId, next)
          setSnapshot(next)
        },
        (cause: unknown) => {
          if (stale()) {
            return
          }

          setLoading(false)

          if (cached === undefined) {
            setSnapshot(undefined)
            setError(describeAgentCliFailure(cause, '无法读取模型清单。'))
          }
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

/* describeExit 曾在这里。另一处有一份逐字相同的副本，两份都搬进了 agentCliText.ts。 */
