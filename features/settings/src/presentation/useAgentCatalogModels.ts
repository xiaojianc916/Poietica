import {
  type AgentCatalogModel,
  agentProviderCatalogModelsArgs,
  parseAgentProviderCatalogModelsOutput,
} from '@poietica/agent-registry'
import { useEffect, useRef, useState } from 'react'
import type { AgentConfigStore } from '../ports/agent-config-store'
import { describeAgentCliExit, describeAgentCliFailure } from './agentCliText'

/**
 * 问某一家厂商在 agent 的目录里有哪些模型。
 *
 * 按需：enabled 为假时一次进程都不起。目录要联网拉 models.dev，页面一打开就替所有厂商
 * 各起一个进程是替用户做了他没要求的事。
 *
 * 这份状态不缓存也不落盘：模型清单是对方的目录，缓存一份就等着有一天显示的是上个月的
 * 清单，而用户看不出来。
 */
export interface AgentCatalogModelsState {
  readonly loading: boolean
  readonly models: readonly AgentCatalogModel[]
  readonly error: string | null
}

const IDLE: AgentCatalogModelsState = { loading: false, models: [], error: null }

export function useAgentCatalogModels(
  store: AgentConfigStore,
  agentId: string,
  providerId: string,
  enabled: boolean,
): AgentCatalogModelsState {
  const [state, setState] = useState<AgentCatalogModelsState>(IDLE)

  /* 每次询问领一个号，只有最新的号有权写状态；卸载时递增一次，在飞的那次自然作废。 */
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1

    const mine = generation.current
    const stale = () => mine !== generation.current
    const discard = () => {
      generation.current += 1
    }

    if (!enabled || providerId === '') {
      setState(IDLE)
      return discard
    }

    let args: readonly string[]

    try {
      args = agentProviderCatalogModelsArgs(providerId)
    } catch (cause: unknown) {
      setState({
        loading: false,
        models: [],
        error: describeAgentCliFailure(cause, '这个厂商标识没法安全地交给命令行。'),
      })
      return discard
    }

    setState({ loading: true, models: [], error: null })

    void store.execCli({ agentId, args, secretVar: '', secretValue: '' }).then(
      (outcome) => {
        if (stale()) {
          return
        }

        if (outcome.status !== 0) {
          setState({
            loading: false,
            models: [],
            error: describeAgentCliExit(outcome.status, outcome.stderr),
          })
          return
        }

        const parsed = parseAgentProviderCatalogModelsOutput(outcome.stdout, providerId)

        setState({ loading: false, models: parsed.models, error: parsed.issues[0] ?? null })
      },
      (cause: unknown) => {
        if (stale()) {
          return
        }

        setState({
          loading: false,
          models: [],
          error: describeAgentCliFailure(cause, '无法向 agent 询问这家厂商的模型。'),
        })
      },
    )

    return discard
  }, [agentId, enabled, providerId, store])

  return state
}
