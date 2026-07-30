import { type AgentProviderPreset, agentProviderCatalogAddArgs } from '@poietica/agent-registry'
import { Switch } from '@poietica/foundations-design-system'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentConfigStore } from '../ports/agent-config-store'
import { describeAgentCliExit, describeAgentCliFailure } from './agentCliText'
import { OptionSelect, SubField } from './models-fields'

/*
 * 一家厂商的凭据卡。传进来的是 builtinAgentProviders 的一条。
 *
 * 上一版这张卡开开关就起一个子进程，问 agent「这家有哪些模型」。那条路作废了：agent 的
 * 目录命令每次都要现拉 models.dev，拉不到就直接失败，没有内置兜底。候选模型改成内置表，
 * 于是开关一拨就有清单 —— 不起进程、离线也有、也没有那句「正在询问…」。
 *
 * 手填「基础地址」那一格删了。接口地址属于厂商身份，内置就够；Zed 也不把它放进密钥
 * 界面（api_url() 从设置里读，空则用常量）。真要改地址的场景是自建网关，那是另一类
 * provider，不该让每个填密钥的人都先看见一个空框。
 *
 * 模型名不给键盘：用户记不住 gpt 后面是点还是横线，这不是用户的问题。
 *
 * 密钥不上命令行、不落我们的盘：随一次 execCli 经环境变量进子进程，写进 agent 自己的
 * 配置之后就与我们无关 —— 包括「配没配过」，答案在上面那张模型列表里。
 *
 * 写入仍然走 agent 的 catalog add，所以在拿不到 models.dev 的网络里它会失败，界面会把
 * agent 的原话显示出来。不粉饰：那句失败正是下一刀要修的东西（把内置表按目录形状喂给
 * catalog add 的 --url）。
 */
export interface ProviderKeyCardProps {
  readonly store: AgentConfigStore
  readonly agentId: string
  readonly provider: AgentProviderPreset
  /** 档案声明的注入变量名。缺席时不写入，而不是自己挑一个名字。 */
  readonly registryKeyVar: string | undefined
  readonly onSaved: () => void
}

export function ProviderKeyCard({
  store,
  agentId,
  provider,
  registryKeyVar,
  onSaved,
}: ProviderKeyCardProps) {
  const [enabled, setEnabled] = useState(false)
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  /* 写入是一次往返，期间用户可以切走。卸载之后再 setState 是一次无处可去的更新。 */
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  const options = useMemo<readonly (readonly [string, string])[]>(() => {
    return provider.models.map((model) => [model.id, model.displayName] as const)
  }, [provider.models])

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

  const submit = useCallback(() => {
    if (registryKeyVar === undefined) {
      setMessage('这个 agent 没有声明该往哪个环境变量注入密钥，无法从这里写入。')
      return
    }

    const secret = apiKey.trim()

    if (secret.length === 0) {
      return
    }

    let args: readonly string[]

    /*
     * 条件展开而不是传 undefined：exactOptionalPropertyTypes 下，可选属性收不了一个
     * 显式的 undefined。
     */
    try {
      args = agentProviderCatalogAddArgs({
        providerId: provider.id,
        ...(modelValue === '' ? {} : { defaultModelId: modelValue }),
        ...(provider.baseUrl === '' ? {} : { baseUrl: provider.baseUrl }),
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
  }, [agentId, apiKey, modelValue, onSaved, provider, registryKeyVar, store])

  return (
    <div className="models-card">
      <div className="models-row">
        <div className="models-row__copy">
          <strong>{provider.displayName}</strong>
          <p>{provider.description}</p>
        </div>

        <div className="models-row__control">
          <Switch
            aria-label={provider.displayName}
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
          {message !== null ? <p className="models-empty">{message}</p> : null}

          {options.length > 0 ? (
            <div className="models-row models-row--field">
              <span className="models-row__name">默认模型</span>

              <div className="models-row__control">
                <OptionSelect
                  ariaLabel={`${provider.displayName} 默认模型`}
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
            placeholder={`输入 ${provider.displayName} API 密钥`}
            secret
            value={apiKey}
          />

          <div className="models-row models-row--field">
            <span className="models-row__name">密钥申请地址</span>

            <div className="models-row__control">
              <span className="models-row__meta">{provider.apiKeysUrl}</span>
            </div>
          </div>

          <div className="models-row models-row--field">
            <span className="models-row__name">
              接口地址 {provider.baseUrl} · 密钥经环境变量交给 agent，不经命令行、不落盘
            </span>

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
