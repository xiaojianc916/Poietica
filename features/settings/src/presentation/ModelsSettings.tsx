import {
  type AcpAgentProfile,
  type AgentModelState,
  acpAgents,
  builtinAcpAgentProfiles,
  defaultAcpAgent,
} from '@poietica/agent-registry'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectList,
  type SelectOption,
  SelectTrigger,
  Switch,
} from '@poietica/foundations-design-system'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentConfigSnapshot, AgentConfigStore } from '../ports/agent-config-store'
import { useAgentProviders } from './useAgentProviders'
import './models-settings.css'

/*
 * 设置 · 模型：模型清单是问出来的。
 *
 * 「智能体」那一行选的是 ACP agent，名单来自 @poietica/agent-registry，是封闭的。
 * 这一行落在 agents.json，与 settings.json 各自独立。
 *
 * 模型清单来自所选 agent 自己的 provider list —— 我们不存目录、不存模型、不存
 * 密钥。所以这一页没有「保存」这个动作，它显示的就是 agent 此刻的真实配置。
 *
 * 密钥输入框还只有界面。写入要走 agent 官方 CLI，那是下一刀。
 *
 * 文案统一简体中文。模型名与 Azure OpenAI / AWS Bedrock / Access Key ID 保留原文：
 * 它们是产品名与服务商固定字段名，翻译会与对方文档对不上。
 */

/*
 * 折叠时显示多少条。
 *
 * 这个数字不能等于任何一份数据的长度。上一版它是 11，而写死的目录恰好 11 项，
 * 于是展开与折叠返回同一个数组，「查看全部模型」点了不动。数字与数据长度相等
 * 本身就是那份目录不该存在的证据。
 */
const COLLAPSED_MODEL_LIMIT = 8

/*
 * 可选的 ACP agent。
 *
 * 名单来自 @poietica/agent-registry，是封闭的 —— 用户在注册过的几家里选，不能自带
 * 一条命令。今天只注册了 Kimi Code 一家，所以下拉里只会有一项；接第二家时这里一个
 * 字都不用改，加的是 agents/<name>.ts。
 */
const AGENT_OPTIONS: readonly (readonly [string, string])[] = acpAgents().map(
  (agent) => [agent.id, agent.displayName] as const,
)

interface KeyDraft {
  readonly openaiKey: string
  readonly openaiBaseUrlOverride: boolean
  readonly openaiBaseUrl: string
  readonly anthropicKey: string
  readonly googleKey: string
  readonly azureEnabled: boolean
  readonly azureBaseUrl: string
  readonly azureDeployment: string
  readonly azureKey: string
  readonly bedrockEnabled: boolean
  readonly bedrockAccessKeyId: string
  readonly bedrockSecretKey: string
  readonly bedrockRegion: string
}

const EMPTY_KEY_DRAFT: KeyDraft = {
  openaiKey: '',
  openaiBaseUrlOverride: false,
  openaiBaseUrl: '',
  anthropicKey: '',
  googleKey: '',
  azureEnabled: false,
  azureBaseUrl: '',
  azureDeployment: '',
  azureKey: '',
  bedrockEnabled: false,
  bedrockAccessKeyId: '',
  bedrockSecretKey: '',
  bedrockRegion: '',
}

export interface ModelsSettingsProps {
  readonly store: AgentConfigStore
}

export function ModelsSettings({ store }: ModelsSettingsProps) {
  const [agentId, setAgentId] = useState<string>(() => defaultAcpAgent().id)
  const [agentOptions, setAgentOptions] =
    useState<readonly (readonly [string, string])[]>(AGENT_OPTIONS)
  const [profiles, setProfiles] = useState<readonly AcpAgentProfile[]>([])
  const [agentError, setAgentError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [keys, setKeys] = useState<KeyDraft>(EMPTY_KEY_DRAFT)

  const providers = useAgentProviders(store, agentId)

  /* agent 报回来的模型，拍平成一列。分组信息留在每一行的右侧小字里。 */
  const allModels = useMemo(() => {
    return providers.snapshot?.providers.flatMap((provider) => provider.models) ?? []
  }, [providers.snapshot])

  const visibleModels = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const matched = keyword
      ? allModels.filter((model) => model.displayName.toLowerCase().includes(keyword))
      : allModels
    return showAll || keyword ? matched : matched.slice(0, COLLAPSED_MODEL_LIMIT)
  }, [allModels, query, showAll])

  const patchKeys = useCallback((patch: Partial<KeyDraft>) => {
    setKeys((current) => ({ ...current, ...patch }))
  }, [])

  /* agent 自己报的配置问题。它比我们更清楚哪一条坏了。 */
  const providerIssues = useMemo(() => {
    const issues = providers.snapshot?.issues ?? []

    return issues.length > 0 ? issues.join('；') : null
  }, [providers.snapshot])

  /*
   * 列表位置该显示什么。
   *
   * 四种情况算在一处而不是在 JSX 里套三层三元：出错、正在问、一个模型都没配、
   * 筛没了。返回 null 表示该画列表。
   */
  const modelListMessage = useMemo(() => {
    if (providers.error !== null) {
      return providers.error
    }

    if (providers.loading) {
      return '正在向 agent 询问已配置的模型…'
    }

    if (allModels.length === 0) {
      return '这个 agent 还没有配置任何模型。填入密钥后它会自己拉取模型清单。'
    }

    if (visibleModels.length === 0) {
      return '没有匹配的模型。'
    }

    return null
  }, [allModels.length, providers.error, providers.loading, visibleModels.length])

  const applySnapshot = useCallback((snapshot: AgentConfigSnapshot) => {
    const options = snapshot.agents.map((agent) => [agent.id, agent.displayName] as const)

    setProfiles(snapshot.agents)
    setAgentOptions(options.length > 0 ? options : AGENT_OPTIONS)
    setAgentId(snapshot.defaultAgentId)
    setAgentError(snapshot.issues.length > 0 ? snapshot.issues.join('；') : null)
  }, [])

  /*
   * 读一次落盘的配置。
   *
   * active 标志防的是「切走设置页时请求才回来」：卸载之后再 setState 是一次无处
   * 可去的更新。
   */
  useEffect(() => {
    let active = true

    void store.load().then(
      (snapshot) => {
        if (active) {
          applySnapshot(snapshot)
        }
      },
      (cause: unknown) => {
        if (active) {
          setAgentError(describeAgentError(cause))
        }
      },
    )

    return () => {
      active = false
    }
  }, [applySnapshot, store])

  /*
   * 选中即落盘。
   *
   * 先把界面切过去，失败再切回来：这一步只改 agents.json 的一个字段，成功是常态，
   * 让下拉干等一次往返只会显得迟钝。回滚用的是点击前的那个值，而不是「默认值」——
   * 否则一次失败会把用户先前的选择也一并抹掉。
   *
   * 档案为空时补一份内置档案：首次写入要让 agents.json 里真的有东西，否则存进去
   * 一个空名单，读回来又被回退逻辑换成内置的，落盘等于没发生。
   */
  const selectAgent = useCallback(
    (nextId: string) => {
      const previousId = agentId

      setAgentId(nextId)
      setAgentError(null)

      void store
        .saveAgents({
          agents: profiles.length > 0 ? profiles : builtinAcpAgentProfiles(),
          defaultAgentId: nextId,
        })
        .then(applySnapshot, (cause: unknown) => {
          setAgentId(previousId)
          setAgentError(describeAgentError(cause))
        })
    },
    [agentId, applySnapshot, profiles, store],
  )

  return (
    <section className="models-page">
      <p className="models-notice">
        模型清单来自所选 agent 自己的配置，Poietica 不保存第二份。下面的密钥输入框还只有界面。
      </p>

      <div className="models-block">
        <span className="models-block__label">智能体</span>

        <div className="models-card">
          <div className="models-row">
            <div className="models-row__copy">
              <strong>ACP Agent</strong>
              <p>
                {agentError ?? providerIssues ?? '选择用于对话的 agent，可用模型与密钥由它提供'}
              </p>
            </div>

            <div className="models-row__control">
              <OptionSelect
                ariaLabel="ACP Agent"
                onChange={selectAgent}
                options={agentOptions}
                value={agentId}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="models-card models-card--list">
        <div className="models-toolbar">
          <input
            aria-label="添加或搜索模型"
            className="models-input models-input--search"
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            placeholder="添加或搜索模型"
            type="text"
            value={query}
          />

          <button
            aria-label="重新向 agent 询问模型清单"
            className="models-icon-button"
            onClick={providers.reload}
            type="button"
          >
            <RefreshIcon />
          </button>
        </div>

        <div className="models-list">
          {modelListMessage !== null ? (
            <p className="models-empty">{modelListMessage}</p>
          ) : (
            visibleModels.map((model) => <ModelRow key={model.alias} model={model} />)
          )}
        </div>

        {allModels.length > COLLAPSED_MODEL_LIMIT ? (
          <button
            className="models-link"
            onClick={() => {
              setShowAll((current) => !current)
            }}
            type="button"
          >
            {showAll ? '收起模型列表' : '查看全部模型'}
          </button>
        ) : null}
      </div>

      <details className="models-keys">
        <summary className="models-keys__summary">
          <ChevronIcon />
          <span>API 密钥</span>
        </summary>

        <div className="models-keys__body">
          <KeyField
            description="填入你自己的 OpenAI 密钥，按用量直接计费到该账号。"
            label="OpenAI API 密钥"
            onChange={(value) => {
              patchKeys({ openaiKey: value })
            }}
            placeholder="输入 OpenAI API 密钥"
            value={keys.openaiKey}
          />

          <div className="models-card">
            <div className="models-row">
              <div className="models-row__copy">
                <strong>覆盖 OpenAI Base URL</strong>
                <p>更改 OpenAI 接口请求使用的基础地址。</p>
              </div>

              <div className="models-row__control">
                <Switch
                  aria-label="覆盖 OpenAI Base URL"
                  checked={keys.openaiBaseUrlOverride}
                  onCheckedChange={(checked) => {
                    patchKeys({ openaiBaseUrlOverride: checked })
                  }}
                  size="sm"
                />
              </div>
            </div>

            {keys.openaiBaseUrlOverride ? (
              <SubField
                label="基础地址"
                onChange={(value) => {
                  patchKeys({ openaiBaseUrl: value })
                }}
                placeholder="例如 https://api.openai.com/v1"
                value={keys.openaiBaseUrl}
              />
            ) : null}
          </div>

          <KeyField
            description={
              '填入你自己的 Anthropic 密钥，按用量直接计费。启用后，所有claude模型都会使用该密钥。'
            }
            label="Anthropic API 密钥"
            onChange={(value) => {
              patchKeys({ anthropicKey: value })
            }}
            placeholder="输入 Anthropic API 密钥"
            value={keys.anthropicKey}
          />

          <KeyField
            description="填入你的 Google AI Studio 密钥，按用量直接计费。"
            label="Google API 密钥"
            onChange={(value) => {
              patchKeys({ googleKey: value })
            }}
            placeholder="输入 Google AI Studio API 密钥"
            value={keys.googleKey}
          />

          <div className="models-card">
            <div className="models-row">
              <div className="models-row__copy">
                <strong>Azure OpenAI</strong>
                <p>通过你的 Azure 账号调用 OpenAI 模型。</p>
              </div>

              <div className="models-row__control">
                <Switch
                  aria-label="Azure OpenAI"
                  checked={keys.azureEnabled}
                  onCheckedChange={(checked) => {
                    patchKeys({ azureEnabled: checked })
                  }}
                  size="sm"
                />
              </div>
            </div>

            <SubField
              disabled={!keys.azureEnabled}
              label="基础地址"
              onChange={(value) => {
                patchKeys({ azureBaseUrl: value })
              }}
              placeholder="例如 my-resource.openai.azure.com"
              value={keys.azureBaseUrl}
            />

            <SubField
              disabled={!keys.azureEnabled}
              label="部署名称"
              onChange={(value) => {
                patchKeys({ azureDeployment: value })
              }}
              placeholder="例如 gpt-35-turbo"
              value={keys.azureDeployment}
            />

            <SubField
              disabled={!keys.azureEnabled}
              label="API 密钥"
              onChange={(value) => {
                patchKeys({ azureKey: value })
              }}
              placeholder="输入 Azure OpenAI API 密钥"
              secret
              value={keys.azureKey}
            />
          </div>

          <div className="models-card">
            <div className="models-row">
              <div className="models-row__copy">
                <strong>AWS Bedrock</strong>
                <p>通过你的 AWS 账号调用 Anthropic Claude 模型。</p>
              </div>

              <div className="models-row__control">
                <Switch
                  aria-label="AWS Bedrock"
                  checked={keys.bedrockEnabled}
                  onCheckedChange={(checked) => {
                    patchKeys({ bedrockEnabled: checked })
                  }}
                  size="sm"
                />
              </div>
            </div>

            <SubField
              disabled={!keys.bedrockEnabled}
              label="Access Key ID"
              onChange={(value) => {
                patchKeys({ bedrockAccessKeyId: value })
              }}
              placeholder="AWS Access Key ID"
              value={keys.bedrockAccessKeyId}
            />

            <SubField
              disabled={!keys.bedrockEnabled}
              label="Secret Access Key"
              onChange={(value) => {
                patchKeys({ bedrockSecretKey: value })
              }}
              placeholder="AWS Secret Access Key"
              secret
              value={keys.bedrockSecretKey}
            />

            <SubField
              disabled={!keys.bedrockEnabled}
              label="区域"
              onChange={(value) => {
                patchKeys({ bedrockRegion: value })
              }}
              placeholder="例如 us-east-1"
              value={keys.bedrockRegion}
            />
          </div>
        </div>
      </details>
    </section>
  )
}

interface ModelRowProps {
  readonly model: AgentModelState
}

/*
 * 一行模型。
 *
 * 右侧没有开关。agent 报回来的模型就是它此刻能用的模型，我们这边拨一下不会让
 * 它多一个或少一个；上一版那个开关拨了确实什么也没发生。「哪些模型出现在选择
 * 器里」是我们自己的偏好，需要一个自己的落脚处，那是下一刀。
 */
function ModelRow({ model }: ModelRowProps) {
  return (
    <div className="models-row models-row--compact">
      <span className="models-row__name">{model.displayName}</span>

      <div className="models-row__control">
        <span className="models-row__meta">{describeModel(model)}</span>
      </div>
    </div>
  )
}

/* 右侧那行小字：谁提供的，能装多少。取不到就留空，不编。 */
function describeModel(model: AgentModelState): string {
  const parts: string[] = []

  if (model.providerId !== undefined) {
    parts.push(model.providerId)
  }

  if (model.maxContextSize !== undefined) {
    parts.push(`${Math.round(model.maxContextSize / 1000)}K 上下文`)
  }

  return parts.join(' · ')
}

interface KeyFieldProps {
  readonly label: string
  readonly description: string
  readonly placeholder: string
  readonly value: string
  readonly onChange: (value: string) => void
}

function KeyField({ label, description, placeholder, value, onChange }: KeyFieldProps) {
  return (
    <div className="models-field">
      <strong>{label}</strong>
      <p>{description}</p>

      <input
        aria-label={label}
        autoComplete="off"
        className="models-input"
        onChange={(event) => {
          onChange(event.target.value)
        }}
        placeholder={placeholder}
        type="password"
        value={value}
      />
    </div>
  )
}

interface SubFieldProps {
  readonly label: string
  readonly placeholder: string
  readonly value: string
  readonly disabled?: boolean
  readonly secret?: boolean
  readonly onChange: (value: string) => void
}

function SubField({
  label,
  placeholder,
  value,
  disabled = false,
  secret = false,
  onChange,
}: SubFieldProps) {
  return (
    <div className="models-row models-row--field">
      <span className="models-row__name">{label}</span>

      <div className="models-row__control">
        <input
          aria-label={label}
          autoComplete="off"
          className="models-input models-input--inline"
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          placeholder={placeholder}
          type={secret ? 'password' : 'text'}
          value={value}
        />
      </div>
    </div>
  )
}

function describeAgentError(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'agent 配置操作失败，请重试。'
}

/* 通用的枚举下拉。它只认 [value, label]，喂模型还是喂 agent 对它没区别。 */
interface OptionSelectProps {
  readonly ariaLabel: string
  readonly value: string
  readonly options: readonly (readonly [string, string])[]
  readonly onChange: (value: string) => void
}

function OptionSelect({ ariaLabel, value, options, onChange }: OptionSelectProps) {
  const data: readonly SelectOption[] = options.map(([optionValue, label]) => ({
    value: optionValue,
    label,
  }))

  return (
    <Select data={data} onValueChange={onChange} size="sm" type={ariaLabel} value={value}>
      <SelectTrigger aria-label={ariaLabel} className="models-select-trigger" tone="plain" />

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

/*
 * 图标属性直接写在标签上，不走 spread。
 *
 * lint/a11y/noSvgWithoutTitle 是静态规则：aria-hidden 藏在展开对象里它看不见，
 * 于是把纯装饰图标判成缺少替代文本。
 */
function RefreshIcon(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="models-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </svg>
  )
}

function ChevronIcon(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="models-icon models-icon--chevron"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}
