import { agentProviderCatalogAddArgs } from '@poietica/agent-registry'
import { Switch } from '@poietica/foundations-design-system'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentConfigStore } from '../ports/agent-config-store'
import { describeAgentCliExit, describeAgentCliFailure } from './agentCliText'
import { OptionSelect, SubField } from './models-fields'
import { useAgentCatalogModels } from './useAgentCatalogModels'

/*
 * 一家厂商的凭据卡。
 *
 * 这里原来是 Azure OpenAI 与 AWS Bedrock 两张卡，各三个手填输入框，一格都写不进去 ——
 * 而且注定写不进去：kimi-code 的 providers.md 写明 Bedrock 这类私有协议目录拒绝导入。
 *
 * 模型名不给键盘：候选来自 agent 自己的目录，选中的 id 原样传 --default-model。用户
 * 记不住 gpt 后面是点还是横线，这不是用户的问题，是让他打字这件事本身的问题。
 *
 * 密钥不上命令行、不落我们的盘：随一次 execCli 经环境变量进子进程，写进 agent 自己的
 * 配置文件之后就与我们无关 —— 包括「配没配过」这个问题，答案也在那边（上面那张模型
 * 列表就是答案）。
 *
 * 两张卡结构相同，所以是同一个组件传两次。抄两份的话，改一处文案就会有一处忘了改。
 */
export interface ProviderKeyCardProps {
  readonly store: AgentConfigStore
  readonly agentId: string
  /** 目录里的厂商标识，例如 openai、anthropic。 */
  readonly providerId: string
  readonly title: string
  readonly description: string
  /** 档案声明的注入变量名。缺席时不给写入入口，而不是自己挑一个名字。 */
  readonly registryKeyVar: string | undefined
  readonly onSaved: () => void
}

export function ProviderKeyCard({
  store,
  agentId,
  providerId,
  title,
  description,
  registryKeyVar,
  onSaved,
}: ProviderKeyCardProps) {
  const [enabled, setEnabled] = useState(false)
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const catalog = useAgentCatalogModels(store, agentId, providerId, enabled)

  /* 写入是一次往返，期间用户可以切走。卸载之后再 setState 是一次无处可去的更新。 */
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  const options = useMemo<readonly (readonly [string, string])[]>(() => {
    return catalog.models.map((model) => [model.id, model.displayName] as const)
  }, [catalog.models])

  /*
   * 下拉的值必须是选项之一，否则触发器会显示空白。换厂商之后上一家的 modelId 不再在
   * 选项里，这里就落回第一项，而不是让界面停在一个不存在的选择上。
   */
  const modelValue = useMemo(() => {
    if (modelId !== '' && options.some(([id]) => id === modelId)) {
      return modelId
    }

    return options[0]?.[0] ?? ''
  }, [modelId, options])

  const notice = useMemo(() => {
    if (catalog.error !== null) {
      return catalog.error
    }

    if (catalog.loading) {
      return '正在向 agent 询问这家厂商有哪些模型…'
    }

    if (options.length === 0) {
      return '目录里没有报出这家厂商的模型；仍然可以只填密钥。'
    }

    return message
  }, [catalog.error, catalog.loading, message, options.length])

  const submit = useCallback(() => {
    if (registryKeyVar === undefined) {
      setMessage('这个 agent 没有声明该往哪个环境变量注入密钥，无法从这里写入。')
      return
    }

    const secret = apiKey.trim()

    if (secret.length === 0) {
      return
    }

    const endpoint = baseUrl.trim()
    let args: readonly string[]

    try {
      args = agentProviderCatalogAddArgs({
        providerId,
        defaultModelId: modelValue === '' ? undefined : modelValue,
        baseUrl: endpoint === '' ? undefined : endpoint,
      })
    } catch (cause: unknown) {
      setMessage(describeAgentCliFailure(cause, '这组参数没法安全地交给命令行。'))
      return
    }

    setBusy(true)
    setMessage(null)

    void store.execCli({ agentId, args, secretVar: registryKeyVar, secretValue: secret }).then(
      (outcome) => {
        if (!mounted.current) {
          return
        }

        setBusy(false)

        if (outcome.status !== 0) {
          setMessage(describeAgentCliExit(outcome.status, outcome.stderr))
          return
        }

        setApiKey('')
        setMessage('已写入 agent 自己的配置。')
        onSaved()
      },
      (cause: unknown) => {
        if (!mounted.current) {
          return
        }

        setBusy(false)
        setMessage(describeAgentCliFailure(cause, '写入失败，请重试。'))
      },
    )
  }, [agentId, apiKey, baseUrl, modelValue, onSaved, providerId, registryKeyVar, store])

  return (
    <div className="models-card">
      <div className="models-row">
        <div className="models-row__copy">
          <strong>{title}</strong>
          <p>{description}</p>
        </div>

        <div className="models-row__control">
          <Switch
            aria-label={title}
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked)
            }}
            size="sm"
          />
        </div>
      </div>

      {enabled ? (
        <>
          {notice !== null ? <p className="models-empty">{notice}</p> : null}

          {options.length > 0 ? (
            <div className="models-row models-row--field">
              <span className="models-row__name">默认模型</span>

              <div className="models-row__control">
                <OptionSelect
                  ariaLabel={`${title} 默认模型`}
                  onChange={setModelId}
                  options={options}
                  value={modelValue}
                />
              </div>
            </div>
          ) : null}

          <SubField
            label="API 密钥"
            onChange={setApiKey}
            placeholder={`输入 ${title} API 密钥`}
            secret
            value={apiKey}
          />

          <SubField
            label="基础地址（留空用目录里的）"
            onChange={setBaseUrl}
            placeholder="仅在需要改接口地址时填"
            value={baseUrl}
          />

          <div className="models-row models-row--field">
            <span className="models-row__name">密钥经环境变量交给 agent，不经命令行、不落盘</span>

            <div className="models-row__control">
              <button
                className="models-button"
                disabled={busy || apiKey.trim().length === 0}
                onClick={submit}
                type="button"
              >
                {busy ? '正在写入…' : '保存到 agent'}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
