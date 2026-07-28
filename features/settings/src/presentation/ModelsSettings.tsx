import {
  type AcpAgentProfile,
  acpAgentCommandLine,
  builtinBaseUrl,
  defaultCredentialBinding,
  type ModelProviderProfile,
  parseAcpAgentCommandLine,
} from '@poietica/agent-registry'
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectList,
  type SelectOption,
  SelectTrigger,
  Switch,
} from '@poietica/foundations-design-system'
import { useCallback, useEffect, useState } from 'react'
import type { AgentConfigSnapshot, AgentConfigStore } from '../ports/agent-config-store'
import './models-settings.css'

/*
 * 设置 · 模型
 *
 * 版面沿用原来那一页：任务模型、模型清单、API 密钥。区别是每一格现在都通向
 * 一个真实的落点，而不再只是本次会话里的 React state。
 *
 * 分工只有一条：宿主持有凭据，agent 持有模型。
 *
 * 我们从不直连 provider，请求一律由 ACP agent 子进程发出，所以"当前这轮用哪个
 * 模型"由 agent 在 session/new 之后通过 configOptions 报告，切换入口在聊天
 * 界面。这一页里的开关只决定选择器里出现什么、以及启动时注入哪个默认值——
 * 因此任务模型那两行保留但置灰：宿主没有接口去指定 agent 的子智能体用什么模型，
 * 留着能拨动的控件等于撒谎。
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
        <TaskModelBlock />

        <p className="models-notice">
          模型与 agent 的配置还没有接到本地存储。读写通道（agents.json 与系统钥匙串）要等桌面端
          实现之后才可用，所以下面暂时不列出提供方——与其给你一个按下去没有效果的开关，
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

  const isConfigured = (providerId: string) =>
    snapshot.secrets.find((secret) => secret.providerId === providerId)?.configured === true

  const saveProviders = (next: ModelProviderProfile) => {
    void run(() =>
      store.saveProviders(snapshot.providers.map((one) => (one.id === next.id ? next : one))),
    )
  }

  const saveAgents = (agents: readonly AcpAgentProfile[], defaultAgentId: string) => {
    void run(() => store.saveAgents({ agents, defaultAgentId }))
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

      <TaskModelBlock />

      <ModelListBlock
        isConfigured={isConfigured}
        onProviderChange={saveProviders}
        providers={snapshot.providers}
      />

      <ProviderKeysBlock
        isConfigured={isConfigured}
        onClearSecret={(providerId) => {
          void run(() => store.clearProviderSecret({ providerId }))
        }}
        onProviderChange={saveProviders}
        onSaveSecret={(providerId, value) => {
          void run(() => store.setProviderSecret({ providerId, value }))
        }}
        providers={snapshot.providers}
      />

      <AgentBlock
        agents={snapshot.agents}
        defaultAgentId={snapshot.defaultAgentId}
        onAgentsChange={saveAgents}
        providers={snapshot.providers}
      />
    </section>
  )
}

/*
 * 任务模型。
 *
 * 保留原来的两行版面，但控件是死的：ACP 下宿主无法指定 agent 内部子智能体
 * 使用的模型，那是 agent 自己的实现细节。
 */
function TaskModelBlock() {
  const rows: readonly (readonly [string, string])[] = [
    ['任务模型', '执行本轮任务的模型'],
    ['Explore 子智能体模型', 'agent 内部探索用的模型'],
  ]

  return (
    <div className="models-block">
      <h3 className="models-heading">任务模型</h3>

      <div className="models-card">
        {rows.map(([label, description]) => (
          <div className="models-row" key={label}>
            <div className="models-field">
              <span className="models-label">{label}</span>
              <span className="models-hint">{description}</span>
            </div>

            <ModelSelect
              ariaLabel={label}
              disabled
              onChange={() => {
                // 置灰，永远不会触发。
              }}
              options={[['agent', '由当前会话的 agent 决定']]}
              value="agent"
            />
          </div>
        ))}

        <p className="models-hint">
          这两项由 agent 决定，宿主没有接口去指定：切换当前这轮使用的模型请在聊天界面里操作。
        </p>
      </div>
    </div>
  )
}

interface ModelListBlockProps {
  readonly isConfigured: (providerId: string) => boolean
  readonly onProviderChange: (next: ModelProviderProfile) => void
  readonly providers: readonly ModelProviderProfile[]
}

/*
 * 模型清单。
 *
 * 开关的意思是"在模型选择器里出现"，不是"授权使用"：真值在 agent 手里。
 * 没配密钥的提供方，它的模型开不了——这正是"配好了才能打开"的那条规则。
 */
function ModelListBlock({ isConfigured, onProviderChange, providers }: ModelListBlockProps) {
  const [draftProviderId, setDraftProviderId] = useState(providers[0]?.id ?? '')
  const [draftModel, setDraftModel] = useState('')

  const target = providers.find((provider) => provider.id === draftProviderId) ?? providers[0]

  return (
    <div className="models-block">
      <h3 className="models-heading">模型</h3>

      <div className="models-card">
        {providers.length === 0 ? (
          <p className="models-empty">还没有任何提供方。</p>
        ) : (
          <ul className="models-list">
            {providers.flatMap((provider) =>
              provider.models.map((model) => (
                <ModelRow
                  configured={isConfigured(provider.id)}
                  enabled={provider.favoriteModels.includes(model)}
                  isDefault={provider.defaultModel === model}
                  key={`${provider.id}:${model}`}
                  model={model}
                  onRemove={() => {
                    onProviderChange({
                      ...provider,
                      models: provider.models.filter((one) => one !== model),
                      favoriteModels: provider.favoriteModels.filter((one) => one !== model),
                      defaultModel:
                        provider.defaultModel === model ? undefined : provider.defaultModel,
                    })
                  }}
                  onToggleDefault={() => {
                    onProviderChange({
                      ...provider,
                      defaultModel: provider.defaultModel === model ? undefined : model,
                    })
                  }}
                  onToggleEnabled={(next) => {
                    onProviderChange({
                      ...provider,
                      favoriteModels: next
                        ? [...provider.favoriteModels, model]
                        : provider.favoriteModels.filter((one) => one !== model),
                    })
                  }}
                  providerName={provider.displayName}
                />
              )),
            )}
          </ul>
        )}

        {target ? (
          <div className="models-toolbar">
            <ModelSelect
              ariaLabel="要添加到哪个提供方"
              onChange={setDraftProviderId}
              options={providers.map((provider) => [provider.id, provider.displayName] as const)}
              value={target.id}
            />

            <input
              aria-label="模型 id"
              className="models-input"
              onChange={(event) => {
                setDraftModel(event.target.value)
              }}
              placeholder="模型 id，例如 glm-4.6"
              spellCheck={false}
              type="text"
              value={draftModel}
            />

            <Button
              disabled={draftModel.trim().length === 0}
              onClick={() => {
                const model = draftModel.trim()

                setDraftModel('')

                if (!target.models.includes(model)) {
                  onProviderChange({ ...target, models: [...target.models, model] })
                }
              }}
              size="xs"
              type="button"
              variant="soft"
            >
              添加模型
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface ModelRowProps {
  readonly configured: boolean
  readonly enabled: boolean
  readonly isDefault: boolean
  readonly model: string
  readonly onRemove: () => void
  readonly onToggleDefault: () => void
  readonly onToggleEnabled: (next: boolean) => void
  readonly providerName: string
}

function ModelRow({
  configured,
  enabled,
  isDefault,
  model,
  onRemove,
  onToggleDefault,
  onToggleEnabled,
  providerName,
}: ModelRowProps) {
  return (
    <li className="models-row">
      <div className="models-field">
        <span className="models-model">{model}</span>
        <span className="models-hint">
          {providerName}
          {configured ? '' : ' · 未配置密钥'}
        </span>
      </div>

      <Button
        disabled={!configured}
        onClick={onToggleDefault}
        size="xs"
        type="button"
        variant="soft"
      >
        {isDefault ? '默认' : '设为默认'}
      </Button>

      <Button onClick={onRemove} size="xs" type="button" variant="soft">
        移除
      </Button>

      <Switch
        aria-label={`${providerName} ${model}`}
        checked={enabled && configured}
        disabled={!configured}
        onCheckedChange={onToggleEnabled}
        size="sm"
      />
    </li>
  )
}

interface ProviderKeysBlockProps {
  readonly isConfigured: (providerId: string) => boolean
  readonly onClearSecret: (providerId: string) => void
  readonly onProviderChange: (next: ModelProviderProfile) => void
  readonly onSaveSecret: (providerId: string, value: string) => void
  readonly providers: readonly ModelProviderProfile[]
}

function ProviderKeysBlock({
  isConfigured,
  onClearSecret,
  onProviderChange,
  onSaveSecret,
  providers,
}: ProviderKeysBlockProps) {
  return (
    <div className="models-block">
      <h3 className="models-heading">API 密钥</h3>

      <div className="models-card models-keys">
        <p className="models-hint">
          密钥保存在系统钥匙串，只在启动 agent 的那一刻注入到它的环境变量，不写入任何配置文件。
          改完密钥要重开该 agent 的会话才会生效。
        </p>

        {providers.map((provider) => (
          <ProviderKeyField
            configured={isConfigured(provider.id)}
            key={provider.id}
            onClearSecret={() => {
              onClearSecret(provider.id)
            }}
            onProviderChange={onProviderChange}
            onSaveSecret={(value) => {
              onSaveSecret(provider.id, value)
            }}
            provider={provider}
          />
        ))}
      </div>
    </div>
  )
}

interface ProviderKeyFieldProps {
  readonly configured: boolean
  readonly onClearSecret: () => void
  readonly onProviderChange: (next: ModelProviderProfile) => void
  readonly onSaveSecret: (value: string) => void
  readonly provider: ModelProviderProfile
}

function ProviderKeyField({
  configured,
  onClearSecret,
  onProviderChange,
  onSaveSecret,
  provider,
}: ProviderKeyFieldProps) {
  const [draft, setDraft] = useState('')

  const fallback = builtinBaseUrl(provider.id)
  const overridden = fallback === undefined || provider.baseUrl !== fallback
  const dialectLabel = provider.dialect === 'anthropic' ? 'Anthropic 兼容' : 'OpenAI 兼容'

  return (
    <div className="models-field">
      <div className="models-row">
        <span className="models-label">{provider.displayName}</span>
        <span className="models-badge">{dialectLabel}</span>
        <span className={configured ? 'models-badge models-badge-ok' : 'models-badge'}>
          {configured ? '已配置' : '未配置'}
        </span>
      </div>

      <div className="models-row">
        <input
          aria-label={`${provider.displayName} API 密钥`}
          className="models-input"
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          placeholder={configured ? '已保存，输入新值可覆盖' : '输入 API 密钥'}
          type="password"
          value={draft}
        />

        <Button
          disabled={draft.length === 0}
          onClick={() => {
            onSaveSecret(draft)
            setDraft('')
          }}
          size="xs"
          type="button"
          variant="soft"
        >
          保存
        </Button>

        <Button
          disabled={!configured}
          onClick={onClearSecret}
          size="xs"
          type="button"
          variant="soft"
        >
          清除
        </Button>
      </div>

      <div className="models-row">
        <span className="models-hint">覆盖 Base URL</span>

        <Switch
          aria-label={`覆盖 ${provider.displayName} 的 Base URL`}
          checked={overridden}
          disabled={fallback === undefined}
          onCheckedChange={(next) => {
            if (!next && fallback !== undefined) {
              onProviderChange({ ...provider, baseUrl: fallback })
            }
          }}
          size="sm"
        />
      </div>

      <input
        aria-label={`${provider.displayName} Base URL`}
        className="models-input"
        disabled={!overridden}
        onChange={(event) => {
          onProviderChange({ ...provider, baseUrl: event.target.value })
        }}
        spellCheck={false}
        type="url"
        value={provider.baseUrl}
      />
    </div>
  )
}

interface AgentBlockProps {
  readonly agents: readonly AcpAgentProfile[]
  readonly defaultAgentId: string
  readonly onAgentsChange: (agents: readonly AcpAgentProfile[], defaultAgentId: string) => void
  readonly providers: readonly ModelProviderProfile[]
}

function AgentBlock({ agents, defaultAgentId, onAgentsChange, providers }: AgentBlockProps) {
  const replace = (next: AcpAgentProfile) => {
    onAgentsChange(
      agents.map((one) => (one.id === next.id ? next : one)),
      defaultAgentId,
    )
  }

  return (
    <div className="models-block">
      <h3 className="models-heading">外部 Agent</h3>

      <div className="models-card">
        <div className="models-row">
          <span className="models-label">默认 agent</span>

          <ModelSelect
            ariaLabel="默认 agent"
            onChange={(value) => {
              onAgentsChange(agents, value)
            }}
            options={agents.map((agent) => [agent.id, agent.displayName] as const)}
            value={defaultAgentId}
          />
        </div>

        {agents.map((agent) => (
          <AgentField agent={agent} key={agent.id} onAgentChange={replace} providers={providers} />
        ))}
      </div>
    </div>
  )
}

interface AgentFieldProps {
  readonly agent: AcpAgentProfile
  readonly onAgentChange: (next: AcpAgentProfile) => void
  readonly providers: readonly ModelProviderProfile[]
}

function AgentField({ agent, onAgentChange, providers }: AgentFieldProps) {
  const binding = agent.credentialBinding

  return (
    <div className="models-field">
      <span className="models-label">{agent.displayName}</span>

      <input
        aria-label={`${agent.displayName} 启动命令`}
        className="models-input"
        onChange={(event) => {
          const parsed = parseAcpAgentCommandLine(event.target.value)

          onAgentChange({ ...agent, command: parsed.command, args: parsed.args })
        }}
        spellCheck={false}
        type="text"
        value={acpAgentCommandLine(agent)}
      />

      <div className="models-row">
        <span className="models-hint">凭据来自</span>

        <ModelSelect
          ariaLabel={`${agent.displayName} 的凭据来源`}
          onChange={(value) => {
            const provider = providers.find((one) => one.id === value)

            onAgentChange({
              ...agent,
              credentialBinding:
                provider === undefined
                  ? undefined
                  : defaultCredentialBinding(provider.id, provider.dialect),
            })
          }}
          options={[
            ['', '该 agent 自行管理认证'],
            ...providers.map((provider) => [provider.id, provider.displayName] as const),
          ]}
          value={binding?.providerId ?? ''}
        />
      </div>

      {binding ? (
        <span className="models-hint">
          启动时注入 {binding.baseUrlEnv} 与 {binding.apiKeyEnv}。如果该 agent 自己的配置文件里
          写了同名变量，它会覆盖这里的设置。
        </span>
      ) : null}
    </div>
  )
}

interface ModelSelectProps {
  readonly ariaLabel: string
  readonly disabled?: boolean
  readonly onChange: (value: string) => void
  readonly options: readonly (readonly [string, string])[]
  readonly value: string
}

function ModelSelect({ ariaLabel, disabled = false, onChange, options, value }: ModelSelectProps) {
  const data: readonly SelectOption[] = options.map(([optionValue, label]) => ({
    value: optionValue,
    label,
  }))

  return (
    <Select data={data} disabled={disabled} onValueChange={onChange} type={ariaLabel} value={value}>
      <SelectTrigger
        aria-label={ariaLabel}
        className="models-select-trigger"
        size="sm"
        tone="plain"
      />

      <SelectContent>
        <SelectList>
          <SelectGroup>
            {options.map(([optionValue, label]) => (
              <SelectItem key={optionValue} value={optionValue}>
                {label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectList>
      </SelectContent>
    </Select>
  )
}
