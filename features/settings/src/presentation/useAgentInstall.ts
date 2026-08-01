import { useCallback, useEffect, useState } from 'react'
import type { AgentConfigStore, AgentInstallStatus } from '../ports/agent-config-store'
import { describeAgentCliFailure } from './agentCliText'

/**
 * 这一行该不该出现一颗按钮，出现的话上面写什么。
 *
 * 检测本身在原生侧带 24 小时缓存，所以这里挂载即问：命中缓存的那一次既不起进程也不
 * 走网络。这一层不再叠第二层缓存 —— 两个都自称权威的缓存，早晚会说两套话。
 */
export interface AgentInstallView {
  readonly action: 'none' | 'install' | 'update'
  readonly label: string
  readonly busy: boolean
  readonly error: string | null
  readonly run: () => void
}

const IDLE: AgentInstallView = {
  action: 'none',
  label: '',
  busy: false,
  error: null,
  run: () => undefined,
}

export function useAgentInstall(store: AgentConfigStore, agentId: string): AgentInstallView {
  const [status, setStatus] = useState<AgentInstallStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true

    setStatus(null)
    setError(null)

    void store.loadInstallStatus(agentId).then(
      (next) => {
        if (live) {
          setStatus(next)
        }
      },
      /* 查不到状态就当没这回事：这一行不该因为一次检测失败而多出一句报错。 */
      () => undefined,
    )

    return () => {
      live = false
    }
  }, [agentId, store])

  const run = useCallback(() => {
    setBusy(true)
    setError(null)

    void store.runInstall(agentId).then(
      (next) => {
        setBusy(false)
        setStatus(next)
        /* 装完模型清单就变了。刷新走既有的那一条通道，不另开一条。 */
        store.notifyConfigChanged()
      },
      (cause: unknown) => {
        setBusy(false)
        setError(describeAgentCliFailure(cause, '安装没有完成，请重试。'))
      },
    )
  }, [agentId, store])

  const state = status?.state

  if (busy) {
    return {
      action: state === 'outdated' ? 'update' : 'install',
      label: state === 'outdated' ? '正在更新…' : '正在安装…',
      busy: true,
      error: null,
      run,
    }
  }

  if (state === 'missing') {
    return { action: 'install', label: '安装', busy: false, error, run }
  }

  if (state === 'outdated') {
    const version = status?.latestVersion ?? ''

    return {
      action: 'update',
      label: version.length > 0 ? `更新到 ${version}` : '更新',
      busy: false,
      error,
      run,
    }
  }

  /* current / unknown / unmanaged：装好且没有可做的事，这一行就该是安静的。 */
  return error === null ? IDLE : { ...IDLE, error, run }
}
