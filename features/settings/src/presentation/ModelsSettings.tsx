import {
  type AcpAgentProfile,
  type AgentModelState,
  type AgentProviderSnapshot,
  acpAgentById,
  acpAgents,
  builtinAgentProviders,
  defaultAcpAgent,
  parseAgentProviderListOutput,
} from '@poietica/agent-registry'
import { Button, InlineSpinner } from '@poietica/foundations-design-system'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentConfigSnapshot, AgentConfigStore } from '../ports/agent-config-store'
import { describeAgentCliFailure } from './agentCliText'
import { OptionSelect } from './models-fields'
import { ProviderKeyCard } from './ProviderKeyCard'
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
 * 三家厂商卡的模型清单内置在二进制里（@poietica/agent-registry 的 builtin-provider-catalog）。
 * 为什么不问 agent：它的目录命令每次都现拉 models.dev，拉不到就 exit 1，没有内置兜底 ——
 * 在拿不到那个域名的网络里整条路都不通。Zed 的做法也是内置：provided_models() 里直接
 * models.insert("deepseek-v4-pro")，再叠加用户追加的 available_models。
 *
 * 密钥经环境变量交给 agent，写入由它自己完成。
 *
 * 原来这里有 Azure OpenAI 与 AWS Bedrock 两张卡，各三个手填输入框。删掉不是因为不好看：
 * providers.md 写明 Bedrock 这类私有协议目录拒绝导入，Azure 在 models.dev 目录里有没有
 * 也没有证据；那些「部署名」「区域」填了之后没有任何一处代码会把它们写进任何文件。
 *
 * 文案统一简体中文。厂商名与模型名保留原文：翻译会与对方文档对不上。
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
/*
 * 要显示哪几家。清单内置在 @poietica/agent-registry 里，与这一页无关 —— 这一页只负责
 * 摆卡片。加第四家不用改这里。
 */
const BUILTIN_PROVIDERS = builtinAgentProviders()

const AGENT_OPTIONS: readonly (readonly [string, string])[] = acpAgents().map(
  (agent) => [agent.id, agent.displayName] as const,
)

/*
 * KeyDraft 曾在这里，13 格。其中 12 格没有任何出口：OpenAI 与 Anthropic 的凭据现在由
 * ProviderKeyCard 直接交给 agent 的 CLI，各自持有自己那几格草稿；Azure 与 Bedrock 那
 * 两张卡整个删了。剩下唯一一格 googleKey 不值得一个结构体。
 */

/** agents.json 那条写入失败时说什么。三个调用点共用一句。 */
const AGENT_ACTION_FAILED = 'agent 配置操作失败，请重试。'

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
  const [probing, setProbing] = useState(false)
  const [globalSnapshot, setGlobalSnapshot] = useState<AgentProviderSnapshot | undefined>(undefined)
  const [globalNote, setGlobalNote] = useState<string | null>(null)
  const [keyTails, setKeyTails] = useState<Readonly<Record<string, string>>>({})
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importNote, setImportNote] = useState<string | null>(null)

  const providers = useAgentProviders(store, agentId)

  /*
   * 密钥该注入哪个环境变量名，写在档案里（kimi 是 KIMI_REGISTRY_API_KEY）。
   *
   * 不写死在这里：换第二家 agent 时变量名不一样，而这一页对两家应该是同一段代码。缺席
   * 就是缺席 —— 卡片会说「这个 agent 没有声明」，而不是替它挑一个名字试试看。
   */
  const registryKeyVar = useMemo(() => {
    return profiles.find((profile) => profile.id === agentId)?.registryKeyVar
  }, [agentId, profiles])

  /* 厂商卡的候选需要知道「这家在 agent 里配过没有」。按 id 索引一次，三张卡各取一条。 */
  const configuredByProvider = useMemo(() => {
    const index = new Map<string, AgentProviderSnapshot['providers'][number]>()

    for (const provider of providers.snapshot?.providers ?? []) {
      index.set(provider.id, provider)
    }

    return index
  }, [providers.snapshot])

  /*
   * 一次性导入的第一步：对用户全局 home 跑一次只读的 provider list，把将导入的
   * 内容摆出来。确认后的整份复制在 runImport，由原生侧备份后完成。
   */
  const probeGlobalHome = useCallback(() => {
    if (probing) {
      return
    }

    /* 问什么写在档案里。在这里再抄一遍，就是第二个迟早走样的说法。 */
    const descriptor = acpAgentById(agentId)

    if (descriptor === undefined) {
      setGlobalSnapshot(undefined)
      setGlobalNote(`没有登记 ${agentId} 这个 agent 的接入档案。`)

      return
    }

    /* 与 useAgentProviders 同一条判据：可选就是可选，缺席不发这次调用。 */
    const listArgs = descriptor.providerListArgs

    if (listArgs === undefined) {
      setGlobalSnapshot(undefined)
      setGlobalNote(`${descriptor.displayName} 没有声明查询模型清单的子命令。`)

      return
    }

    setProbing(true)

    void store
      .execCli({
        agentId,
        args: [...listArgs],
        secretVar: '',
        secretValue: '',
        useGlobalHome: true,
      })
      .then(
        (outcome) => {
          setProbing(false)

          if (outcome.status !== 0) {
            setGlobalSnapshot(undefined)
            setGlobalNote('读取全局配置失败。')
            return
          }

          const snapshot = parseAgentProviderListOutput(
            outcome.stdout,
            descriptor.syntheticProviderId,
          )
          const usable = snapshot.providers.filter((provider) => !provider.synthetic)

          setGlobalSnapshot(usable.length > 0 ? { ...snapshot, providers: usable } : undefined)
          setGlobalNote(
            usable.length > 0
              ? null
              : '全局配置里没有可识别的 provider（OAuth 登录的账号不在其中）。',
          )
        },
        () => {
          setProbing(false)
          setGlobalSnapshot(undefined)
          setGlobalNote('读取全局配置失败。')
        },
      )
  }, [agentId, probing, store])

  /*
   * 确认导入：原生侧把全局 config.toml 整份复制进受控 home（先备份）。
   * 导入完成后预览就没用了，清掉；模型列表与尾号随快照刷新自然更新。
   */
  const runImport = useCallback(() => {
    if (importing) {
      return
    }

    setImporting(true)
    setImportNote(null)

    void store.importGlobal(agentId).then(
      (outcome) => {
        setImporting(false)

        if (!outcome.imported) {
          setImportNote('没有找到全局配置可导入。')
          return
        }

        setImportNote(
          outcome.backupPath === null ? '已导入全局配置。' : '已导入全局配置，原受控配置已备份。',
        )
        setGlobalSnapshot(undefined)
        setGlobalNote(null)
        providers.reload()
      },
      (cause: unknown) => {
        setImporting(false)
        setImportNote(describeAgentCliFailure(cause, '导入失败，请重试。'))
      },
    )
  }, [agentId, importing, providers, store])

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

  /* patchKeys 曾在这里。它服务的那份 13 格草稿已经不存在了。 */

  const providerSnapshot = providers.snapshot

  /*
   * 密钥尾号只读现算：与「写经谁手」无关，官方 CLI 配置的也有。
   *
   * 快照变化时重取一次：保存与删除都会引起快照变化，所以不需要额外的失效逻辑。
   * 快照本身参与判断而不只是当失效令牌 —— 它还没到达时列表必然是空的，
   * 那一次往返的结果没有任何去处。
   */
  useEffect(() => {
    if (providerSnapshot === undefined) {
      setKeyTails({})
      return
    }

    let active = true

    void store.loadKeyTails(agentId).then(
      (tails) => {
        if (active) {
          setKeyTails(tails)
        }
      },
      () => {
        if (active) {
          setKeyTails({})
        }
      },
    )

    return () => {
      active = false
    }
  }, [agentId, providerSnapshot, store])

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
      return '正在读取模型清单…'
    }

    if (allModels.length === 0) {
      return '这个 agent 还没有配置任何模型。填入密钥、保存之后这里会列出它报回来的模型。'
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
          setAgentError(describeAgentCliFailure(cause, AGENT_ACTION_FAILED))
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
   * 档案一定不为空：store.load() 在磁盘为空时已经把内置档案写进 agents.json 了，
   * 所以这里没有「补一份内置的」这一步。真的读到空只可能是那次读取失败，而这时写
   * 一份空名单进去，原生侧连该起哪个程序都查不到 —— 宁可什么都不做，并说出原因。
   */
  const selectAgent = useCallback(
    (nextId: string) => {
      const previousId = agentId

      if (profiles.length === 0) {
        setAgentError('还没有读到 agent 接入档案，请稍后重试。')
        return
      }

      setAgentId(nextId)
      setAgentError(null)

      void store
        .saveAgents({ agents: profiles, defaultAgentId: nextId })
        .then(applySnapshot, (cause: unknown) => {
          setAgentId(previousId)
          setAgentError(describeAgentCliFailure(cause, AGENT_ACTION_FAILED))
        })
    },
    [agentId, applySnapshot, profiles, store],
  )

  /*
   * 「API 密钥」列表的行：agent 报回来的已配置 provider，各配一行。
   *
   * 行不来自 keyHints：那份表只是尾号备忘，「配没配过」的答案只有一个产地 ——
   * provider list 的快照。环境变量合成的保留条目（synthetic）不出现在这里：
   * 它不是用户配的，也不归用户删。
   */
  const configuredKeyRows = useMemo(() => {
    const rows: Array<{ id: string; label: string; hint: string }> = []

    for (const provider of providers.snapshot?.providers ?? []) {
      if (!provider.configured || provider.synthetic) {
        continue
      }

      const tail = keyTails[provider.id]
      const label =
        BUILTIN_PROVIDERS.find((preset) => preset.id === provider.id)?.displayName ?? provider.id

      rows.push({
        id: provider.id,
        label,
        hint: tail === undefined ? '取不到尾号' : `•••••${tail}`,
      })
    }

    return rows
  }, [keyTails, providers.snapshot])

  /*
   * 删除就是官方 CLI 的 provider remove：provider 与它的全部模型别名一起消失，
   * 默认模型若指着它也会被对方清空（kimi-command.md 逐字）。没有回收站 ——
   * 所以删除是两步：先点「删除」，再点「确认删除」。
   */
  const removeKey = useCallback(
    (providerId: string) => {
      if (deletingId !== null) {
        return
      }

      setDeletingId(providerId)

      void store
        .execCli({
          agentId,
          args: ['provider', 'remove', providerId],
          secretVar: '',
          secretValue: '',
        })
        .then(
          (outcome) => {
            setDeletingId(null)
            setConfirmId(null)

            if (outcome.status !== 0) {
              setAgentError('删除失败，请重试。')
              return
            }

            void store.load().then(applySnapshot)
            providers.reload()
          },
          (cause: unknown) => {
            setDeletingId(null)
            setAgentError(describeAgentCliFailure(cause, '删除失败，请重试。'))
          },
        )
    },
    [agentId, applySnapshot, deletingId, providers, store],
  )

  return (
    <section className="models-page">
      <p className="models-notice models-notice--bar">
        <span>模型清单来自内置名单，也支持从配置文件中反向导入</span>

        <Button disabled={probing} onClick={probeGlobalHome} size="xs" type="button" variant="soft">
          {probing ? '正在读取…' : '导入配置'}
        </Button>
      </p>

      {globalNote !== null ? <p className="models-empty">{globalNote}</p> : null}

      {globalSnapshot !== undefined ? (
        <p className="models-notice models-notice--bar">
          <span>
            在你电脑的全局配置里发现：
            {globalSnapshot.providers
              .map((provider) => {
                const state = provider.configured ? '已配置密钥' : '未配置密钥'
                return `${provider.id}（${provider.models.length} 个模型，${state}）`
              })
              .join('；')}
            。导入将整体替换受控配置（自动先备份），OAuth 账号不在其中。
          </span>

          <Button disabled={importing} onClick={runImport} size="xs" type="button" variant="soft">
            {importing ? '正在导入…' : '确认导入'}
          </Button>
        </p>
      ) : null}

      {importNote !== null ? <p className="models-empty">{importNote}</p> : null}

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
            aria-label="重新读取模型清单"
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
          <span>API 配置</span>
        </summary>

        <div className="models-keys__body">
          {BUILTIN_PROVIDERS.map((preset) => (
            <ProviderKeyCard
              agentId={agentId}
              configured={configuredByProvider.get(preset.id)}
              key={preset.id}
              onSaved={providers.reload}
              provider={preset}
              registryKeyVar={registryKeyVar}
              store={store}
            />
          ))}

          <div className="models-block">
            <span className="models-block__label">API 密钥</span>

            {configuredKeyRows.length > 0 ? (
              <div className="models-card">
                {configuredKeyRows.map((row) => (
                  <div className="models-row models-row--compact" key={row.id}>
                    <span className="models-row__name">{row.label}</span>

                    <div className="models-row__control">
                      <span className="models-row__meta">{row.hint}</span>

                      {confirmId === row.id ? (
                        <>
                          {deletingId !== row.id ? (
                            <Button
                              onClick={() => {
                                setConfirmId(null)
                              }}
                              size="xs"
                              type="button"
                              variant="soft"
                            >
                              取消
                            </Button>
                          ) : null}

                          {deletingId === row.id ? <InlineSpinner /> : null}

                          <Button
                            className="models-button-danger"
                            disabled={deletingId !== null}
                            onClick={() => {
                              removeKey(row.id)
                            }}
                            size="xs"
                            type="button"
                            variant="soft"
                          >
                            {deletingId === row.id ? '正在删除…' : '确认删除'}
                          </Button>
                        </>
                      ) : (
                        <Button
                          className="models-button-danger"
                          onClick={() => {
                            setConfirmId(row.id)
                          }}
                          size="xs"
                          type="button"
                          variant="soft"
                        >
                          删除
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="models-empty">还没有已配置的密钥。</p>
            )}
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

/* KeyField 曾在这里。Google 那一格自始至终没有出口 —— 填了之后没有任何一处代码会
 * 把它交给任何人。死界面不留。
 *
 * SubField 曾在这里。厂商卡也要用它，所以搬到 models-fields.tsx，两处共用一份。 */

/* describeAgentError 曾在这里。它与 useAgentProviders 里那一份是同一件事，两份都进了
 * agentCliText.ts —— 兜底文案由调用方给，因为「读不到档案」与「问不到模型」该说的不是
 * 同一句话。 */

/* OptionSelect 曾在这里。同样搬到 models-fields.tsx：agent 下拉与模型下拉共用一份。 */

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
