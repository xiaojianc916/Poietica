import {
  type AcpAgentProfile,
  acpAgentCommandLine,
  defaultCredentialBinding,
  type ModelProviderProfile,
  parseAcpAgentCommandLine,
} from '@poietica/agent-registry'
import { useCallback, useEffect, useState } from 'react'
import type { AgentConfigSnapshot, AgentConfigStore } from '../ports/agent-config-store'
import './models-settings.css'

/*
 * 设置 · 模型
 *
 * 这一页配置的是"用哪个 agent、拿谁的密钥去跑"，不是"客户端要调用哪个模型 API"——
 * 我们从不直连 provider，请求一律由 ACP agent 子进程发出。
 *
 * 因此模型清单在这里只表达两件事：收藏（影响选择器排序）与默认值（启动时注入）。
 * 一次会话真正能用哪些模型由 agent 通过 ACP 的 configOptions 报告，
 * 切换入口在聊天界面，不在这里。
 */

export interface ModelsSettingsProps {
  /** 未注入时这一页只说明尚未接线，不提供任何存不下的开关。 */
  readonly store?: AgentConfigStore | undefined
}

export function ModelsSettings({ store }: ModelsSettingsProps) {
  const [snapshot, setSnapshot] = useState<AgentConfigSnapshot | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const run = useCallback(async (operation: () => Promise<AgentConfigSnapshot>) => {
    try {
      setSnapshot(await operation())
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模型配置操作失败，请重试。')
    }
  }, [])

  useEffect(() => {
    if (!store) {
      return
    }

    let cancelled = false

    store
      .load()
      .then((loaded) => {
        if (!cancelled) {
          setSnapshot(loaded)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '无法读取模型配置。')
        }
      })

    return () => {
      cancelled = true
    }
  }, [store])

  if (!store) {
    return (
      <section className="models-page">
        <p className="models-notice">
          模型与 agent 的配置还没有接到本地存储。读写通道（agents.json 与系统钥匙串）要等桌面端
          实现之后才可用，所以这一页暂时不提供任何开关——与其给你一个按下去没有效果的按钮，
          不如先把这件事说清楚。
        </p>
      </section>
    )
  }

  if (!snapshot) {
    return (
      <section className="models-page">
        <p className="models-notice">{error ?? '正在读取模型配置…'}</p>
      </section>
    )
  }

  return (
    <section className="models-page">
      {error ? <p className="models-error">{error}</p> : null}

      {snapshot.issues.length > 0 ? (
        <ul className="models-issues">
          {snapshot.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}

      <p className="models-notice">
        密钥保存在系统钥匙串，只在启动 agent 的那一刻注入到它的环境变量，不写入任何配置文件。
        下面勾选的模型只影响选择器里的排序：一次会话真正能用哪些模型由 agent 决定，
        在聊天界面里切换。
      </p>

      <h3 className="models-heading">模型提供方</h3>

      {snapshot.providers.map((provider) => (
        <ProviderCard
          configured={
            snapshot.secrets.find((secret) => secret.providerId === provider.id)?.configured ===
            true
          }
          key={provider.id}
          onClearSecret={() => {
            void run(() => store.clearProviderSecret({ providerId: provider.id }))
          }}
          onProviderChange={(next) => {
            void run(() =>
              store.saveProviders(
                snapshot.providers.map((one) => (one.id === next.id ? next : one)),
              ),
            )
          }}
          onSaveSecret={(value) => {
            void run(() => store.setProviderSecret({ providerId: provider.id, value }))
          }}
          provider={provider}
        />
      ))}

      <h3 className="models-heading">外部 Agent</h3>

      <label className="models-field">
        <span className="models-label">默认 agent</span>

        <select
          className="models-input"
          onChange={(event) => {
            void run(() =>
              store.saveAgents({ agents: snapshot.agents, defaultAgentId: event.target.value }),
            )
          }}
          value={snapshot.defaultAgentId}
        >
          {snapshot.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.displayName}
            </option>
          ))}
        </select>
      </label>

      {snapshot.agents.map((agent) => (
        <AgentCard
          agent={agent}
          key={agent.id}
          onAgentChange={(next) => {
            void run(() =>
              store.saveAgents({
                agents: snapshot.agents.map((one) => (one.id === next.id ? next : one)),
                defaultAgentId: snapshot.defaultAgentId,
              }),
            )
          }}
          providers={snapshot.providers}
        />
      ))}
    </section>
  )
}

interface ProviderCardProps {
  readonly configured: boolean
  readonly onClearSecret: () => void
  readonly onProviderChange: (next: ModelProviderProfile) => void
  readonly onSaveSecret: (value: string) => void
  readonly provider: ModelProviderProfile
}

function ProviderCard({
  configured,
  onClearSecret,
  onProviderChange,
  onSaveSecret,
  provider,
}: ProviderCardProps) {
  const [secretDraft, setSecretDraft] = useState('')
  const [modelDraft, setModelDraft] = useState('')

  const dialectLabel = provider.dialect === 'anthropic' ? 'Anthropic 兼容' : 'OpenAI 兼容'

  return (
    <article className="models-card">
      <header className="models-card-header">
        <span className="models-card-title">{provider.displayName}</span>
        <span className="models-badge">{dialectLabel}</span>
        <span className={configured ? 'models-badge models-badge-ok' : 'models-badge'}>
          {configured ? '密钥已配置' : '未配置密钥'}
        </span>
      </header>

      <label className="models-field">
        <span className="models-label">Base URL</span>

        <input
          className="models-input"
          onChange={(event) => {
            onProviderChange({ ...provider, baseUrl: event.target.value })
          }}
          spellCheck={false}
          type="url"
          value={provider.baseUrl}
        />
      </label>

      <div className="models-field">
        <span className="models-label">API 密钥</span>

        <div className="models-row">
          <input
            aria-label={`${provider.displayName} API 密钥`}
            className="models-input"
            onChange={(event) => {
              setSecretDraft(event.target.value)
            }}
            placeholder={configured ? '已保存，输入新值可覆盖' : '输入 API 密钥'}
            type="password"
            value={secretDraft}
          />

          <button
            className="models-button"
            disabled={secretDraft.length === 0}
            onClick={() => {
              onSaveSecret(secretDraft)
              setSecretDraft('')
            }}
            type="button"
          >
            保存到钥匙串
          </button>

          <button
            className="models-button"
            disabled={!configured}
            onClick={onClearSecret}
            type="button"
          >
            清除
          </button>
        </div>
      </div>

      <div className="models-field">
        <span className="models-label">模型</span>

        <ul className="models-list">
          {provider.models.map((model) => (
            <ModelRow
              favorite={provider.favoriteModels.includes(model)}
              isDefault={provider.defaultModel === model}
              key={model}
              model={model}
              onRemove={() => {
                onProviderChange({
                  ...provider,
                  models: provider.models.filter((one) => one !== model),
                  favoriteModels: provider.favoriteModels.filter((one) => one !== model),
                  defaultModel: provider.defaultModel === model ? undefined : provider.defaultModel,
                })
              }}
              onToggleDefault={() => {
                onProviderChange({
                  ...provider,
                  defaultModel: provider.defaultModel === model ? undefined : model,
                })
              }}
              onToggleFavorite={() => {
                const favorite = provider.favoriteModels.includes(model)

                onProviderChange({
                  ...provider,
                  favoriteModels: favorite
                    ? provider.favoriteModels.filter((one) => one !== model)
                    : [...provider.favoriteModels, model],
                })
              }}
            />
          ))}
        </ul>

        <div className="models-row">
          <input
            aria-label={`为 ${provider.displayName} 添加模型 id`}
            className="models-input"
            onChange={(event) => {
              setModelDraft(event.target.value)
            }}
            placeholder="添加模型 id"
            spellCheck={false}
            type="text"
            value={modelDraft}
          />

          <button
            className="models-button"
            disabled={modelDraft.trim().length === 0}
            onClick={() => {
              const model = modelDraft.trim()

              setModelDraft('')

              if (!provider.models.includes(model)) {
                onProviderChange({ ...provider, models: [...provider.models, model] })
              }
            }}
            type="button"
          >
            添加
          </button>
        </div>
      </div>
    </article>
  )
}

interface ModelRowProps {
  readonly favorite: boolean
  readonly isDefault: boolean
  readonly model: string
  readonly onRemove: () => void
  readonly onToggleDefault: () => void
  readonly onToggleFavorite: () => void
}

function ModelRow({
  favorite,
  isDefault,
  model,
  onRemove,
  onToggleDefault,
  onToggleFavorite,
}: ModelRowProps) {
  return (
    <li className="models-row">
      <span className="models-model">{model}</span>

      <label className="models-toggle">
        <input checked={favorite} onChange={onToggleFavorite} type="checkbox" />
        <span>在选择器中置顶</span>
      </label>

      <button className="models-button" onClick={onToggleDefault} type="button">
        {isDefault ? '取消默认' : '设为默认'}
      </button>

      <button className="models-button" onClick={onRemove} type="button">
        移除
      </button>
    </li>
  )
}

interface AgentCardProps {
  readonly agent: AcpAgentProfile
  readonly onAgentChange: (next: AcpAgentProfile) => void
  readonly providers: readonly ModelProviderProfile[]
}

function AgentCard({ agent, onAgentChange, providers }: AgentCardProps) {
  const binding = agent.credentialBinding

  return (
    <article className="models-card">
      <header className="models-card-header">
        <span className="models-card-title">{agent.displayName}</span>
      </header>

      <label className="models-field">
        <span className="models-label">启动命令</span>

        <input
          className="models-input"
          onChange={(event) => {
            const parsed = parseAcpAgentCommandLine(event.target.value)

            onAgentChange({ ...agent, command: parsed.command, args: parsed.args })
          }}
          spellCheck={false}
          type="text"
          value={acpAgentCommandLine(agent)}
        />
      </label>

      <label className="models-field">
        <span className="models-label">凭据来自</span>

        <select
          className="models-input"
          onChange={(event) => {
            const provider = providers.find((one) => one.id === event.target.value)

            onAgentChange({
              ...agent,
              credentialBinding:
                provider === undefined
                  ? undefined
                  : defaultCredentialBinding(provider.id, provider.dialect),
            })
          }}
          value={binding?.providerId ?? ''}
        >
          <option value="">该 agent 自行管理认证</option>

          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.displayName}
            </option>
          ))}
        </select>
      </label>

      {binding ? (
        <p className="models-hint">
          启动时注入 {binding.baseUrlEnv} 与 {binding.apiKeyEnv}。如果该 agent 自己的配置文件里
          写了同名变量，它会覆盖这里的设置；改完密钥需要重开该 agent 的会话才会生效。
        </p>
      ) : null}
    </article>
  )
}
