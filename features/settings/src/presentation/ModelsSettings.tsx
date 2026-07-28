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
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import './models-settings.css'

/*
 * 设置 · 模型：当前只有界面。
 *
 * AppSettings 里还没有任何模型字段，Provider、密钥存储与网络边界也还没有 owner，
 * 所以这里的状态全部留在组件本地草稿：不写 store、不落盘、不发请求、不读环境变量。
 * 等 domain/settings.ts 与 ports 补上模型契约后，把 useState 换成 controller.update 即可。
 *
 * 因为存不下，界面顶部明确告知“尚未保存”，避免出现拨得动却不生效的假开关。
 */

interface ModelEntry {
  readonly id: string
  readonly label: string
  readonly enabled: boolean
}

const MODEL_CATALOG: readonly ModelEntry[] = [
  { id: 'grok-4.5-fast', label: 'Cursor Grok 4.5 Fast', enabled: true },
  { id: 'composer-2.5-fast', label: 'Composer 2.5 Fast', enabled: true },
  { id: 'opus-5', label: 'Opus 5', enabled: true },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', enabled: true },
  { id: 'fable-5', label: 'Fable 5', enabled: true },
  { id: 'sonnet-5', label: 'Sonnet 5', enabled: true },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', enabled: true },
  { id: 'gemini-3-flash', label: 'Gemini 3 Flash', enabled: true },
  { id: 'grok-4.5-low', label: 'Cursor Grok 4.5 Low', enabled: false },
  { id: 'grok-4.5-low-fast', label: 'Cursor Grok 4.5 Low Fast', enabled: false },
  { id: 'grok-4.5-medium', label: 'Cursor Grok 4.5 Medium', enabled: false },
]

const TASK_MODEL_OPTIONS: readonly (readonly [string, string])[] = MODEL_CATALOG.filter(
  (model) => model.enabled,
).map((model) => [model.id, model.label] as const)

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

export function ModelsSettings() {
  const [taskModel, setTaskModel] = useState<string>('grok-4.5-fast')
  const [models, setModels] = useState<readonly ModelEntry[]>(MODEL_CATALOG)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [keys, setKeys] = useState<KeyDraft>(EMPTY_KEY_DRAFT)

  const visibleModels = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const matched = keyword
      ? models.filter((model) => model.label.toLowerCase().includes(keyword))
      : models
    return showAll || keyword ? matched : matched.slice(0, 11)
  }, [models, query, showAll])

  const toggleModel = useCallback((id: string, enabled: boolean) => {
    setModels((current) =>
      current.map((model) => (model.id === id ? { ...model, enabled } : model)),
    )
  }, [])

  const resetQuery = useCallback(() => {
    setQuery('')
  }, [])

  const patchKeys = useCallback((patch: Partial<KeyDraft>) => {
    setKeys((current) => ({ ...current, ...patch }))
  }, [])

  return (
    <section className="models-page">
      <p className="models-notice">
        模型配置目前只有界面：改动仅保留在本次会话中，不会写入本地设置，也不会发起任何网络请求。
      </p>

      <div className="models-block">
        <span className="models-block__label">Task Models</span>

        <div className="models-card">
          <div className="models-row">
            <div className="models-row__copy">
              <strong>Explore Subagent Model</strong>
              <p>Choose the model used by the Explore subagent for initial research</p>
            </div>

            <div className="models-row__control">
              <ModelSelect
                ariaLabel="Explore Subagent Model"
                onChange={setTaskModel}
                options={TASK_MODEL_OPTIONS}
                value={taskModel}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="models-card models-card--list">
        <div className="models-toolbar">
          <input
            aria-label="Add or search model"
            className="models-input models-input--search"
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            placeholder="Add or search model"
            type="text"
            value={query}
          />

          <button
            aria-label="重置模型筛选"
            className="models-icon-button"
            onClick={resetQuery}
            type="button"
          >
            <RefreshIcon />
          </button>
        </div>

        <div className="models-list">
          {visibleModels.length === 0 ? (
            <p className="models-empty">没有匹配的模型。</p>
          ) : (
            visibleModels.map((model) => (
              <div className="models-row models-row--compact" key={model.id}>
                <span className="models-row__name">{model.label}</span>

                <div className="models-row__control">
                  <Switch
                    aria-label={model.label}
                    checked={model.enabled}
                    onCheckedChange={(checked) => {
                      toggleModel(model.id, checked)
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <button
          className="models-link"
          onClick={() => {
            setShowAll((current) => !current)
          }}
          type="button"
        >
          {showAll ? 'Show Fewer Models' : 'View All Models'}
        </button>
      </div>

      <details className="models-keys">
        <summary className="models-keys__summary">
          <ChevronIcon />
          <span>API Keys</span>
        </summary>

        <div className="models-keys__body">
          <KeyField
            description="You can put in your OpenAI key to use OpenAI models at cost."
            label="OpenAI API Key"
            onChange={(value) => {
              patchKeys({ openaiKey: value })
            }}
            placeholder="Enter your OpenAI API Key"
            value={keys.openaiKey}
          />

          <div className="models-card">
            <div className="models-row">
              <div className="models-row__copy">
                <strong>Override OpenAI Base URL</strong>
                <p>Change the base URL for OpenAI API requests.</p>
              </div>

              <div className="models-row__control">
                <Switch
                  aria-label="Override OpenAI Base URL"
                  checked={keys.openaiBaseUrlOverride}
                  onCheckedChange={(checked) => {
                    patchKeys({ openaiBaseUrlOverride: checked })
                  }}
                />
              </div>
            </div>

            {keys.openaiBaseUrlOverride ? (
              <SubField
                label="Base URL"
                onChange={(value) => {
                  patchKeys({ openaiBaseUrl: value })
                }}
                placeholder="e.g. https://api.openai.com/v1"
                value={keys.openaiBaseUrl}
              />
            ) : null}
          </div>

          <KeyField
            description={
              'You can put in your Anthropic key to use Claude at cost. When enabled, ' +
              'this key will be used for all models beginning with "claude-".'
            }
            label="Anthropic API Key"
            onChange={(value) => {
              patchKeys({ anthropicKey: value })
            }}
            placeholder="Enter your Anthropic API Key"
            value={keys.anthropicKey}
          />

          <KeyField
            description="You can put in your Google AI Studio key to use Google models at-cost."
            label="Google API Key"
            onChange={(value) => {
              patchKeys({ googleKey: value })
            }}
            placeholder="Enter your Google AI Studio API Key"
            value={keys.googleKey}
          />

          <div className="models-card">
            <div className="models-row">
              <div className="models-row__copy">
                <strong>Azure OpenAI</strong>
                <p>Configure Azure OpenAI to use OpenAI models through your Azure account.</p>
              </div>

              <div className="models-row__control">
                <Switch
                  aria-label="Azure OpenAI"
                  checked={keys.azureEnabled}
                  onCheckedChange={(checked) => {
                    patchKeys({ azureEnabled: checked })
                  }}
                />
              </div>
            </div>

            <SubField
              disabled={!keys.azureEnabled}
              label="Base URL"
              onChange={(value) => {
                patchKeys({ azureBaseUrl: value })
              }}
              placeholder="e.g. my-resource.openai.azure.com"
              value={keys.azureBaseUrl}
            />

            <SubField
              disabled={!keys.azureEnabled}
              label="Deployment Name"
              onChange={(value) => {
                patchKeys({ azureDeployment: value })
              }}
              placeholder="e.g. gpt-35-turbo"
              value={keys.azureDeployment}
            />

            <SubField
              disabled={!keys.azureEnabled}
              label="API Key"
              onChange={(value) => {
                patchKeys({ azureKey: value })
              }}
              placeholder="Enter your Azure OpenAI API Key"
              secret
              value={keys.azureKey}
            />
          </div>

          <div className="models-card">
            <div className="models-row">
              <div className="models-row__copy">
                <strong>AWS Bedrock</strong>
                <p>
                  Configure AWS Bedrock to use Anthropic Claude models through your AWS account.
                </p>
              </div>

              <div className="models-row__control">
                <Switch
                  aria-label="AWS Bedrock"
                  checked={keys.bedrockEnabled}
                  onCheckedChange={(checked) => {
                    patchKeys({ bedrockEnabled: checked })
                  }}
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
              label="Region"
              onChange={(value) => {
                patchKeys({ bedrockRegion: value })
              }}
              placeholder="e.g. us-east-1"
              value={keys.bedrockRegion}
            />
          </div>
        </div>
      </details>
    </section>
  )
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

interface ModelSelectProps {
  readonly ariaLabel: string
  readonly value: string
  readonly options: readonly (readonly [string, string])[]
  readonly onChange: (value: string) => void
}

function ModelSelect({ ariaLabel, value, options, onChange }: ModelSelectProps) {
  const data: readonly SelectOption[] = options.map(([optionValue, label]) => ({
    value: optionValue,
    label,
  }))

  return (
    <Select data={data} onValueChange={onChange} type={ariaLabel} value={value}>
      <SelectTrigger aria-label={ariaLabel} className="models-select-trigger" />

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
 * 于是把纯装饰图标判成缺少替代文本。摊平后规则与读屏软件看到的是同一件事。
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
