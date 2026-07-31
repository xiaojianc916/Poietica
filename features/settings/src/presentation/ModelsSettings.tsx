import {
  type AcpAgentProfile,
  type AgentModelState,
  type AgentProviderSnapshot,
  acpAgentById,
  acpAgents,
  agentBareModelId,
  agentModelDisplayName,
  agentProviderCatalogAddArgs,
  agentProviderDefaultModelId,
  agentProviderImportDocument,
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

/** 一家没导进去，以及 agent 说的原因。 */
interface ImportFailure {
  readonly id: string
  readonly reason: string
}

/*
 * agent 拒绝这一次写入时说了什么。
 *
 * 上游每一条失败路径都先往 stderr 写一行再退出，所以第一行非空就是全部原因
 * （`Provider "x" not found in catalog at ...`、`Missing API key.`、
 * `... lists no usable models ...`）。原文直出不改写：那一行指得到地方，
 * 而一句读着体面的「导入失败」指不到任何地方。
 *
 * stderr 空就退回 stdout —— 有些失败是 commander 层打印的；两样都空时只剩
 * 退出码，那也比不说强。
 */
function reasonOf(outcome: {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}): string {
  const spoken = [outcome.stderr, outcome.stdout]
    .flatMap((stream) => stream.split('\n'))
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return spoken ?? `退出码 ${String(outcome.status)}`
}

/*
 * 导入一家 provider。
 *
 * 它是模块级函数而不是 runImport 里的一段：那个回调本来同时管着「谁来定
 * default_model」「逐家串行」「失败逐条记名」三件事，挤在一处读不出层次 —— lint
 * 报的复杂度只是这件事的一个读数。
 *
 * 这里只回答一个问题：这一家成了没有。成了是 undefined，没成是一条带着对方原话的
 * 失败 —— 不抛异常，因为「一家没导进去」是调用方要逐条说给用户听的结果，不是意外。
 */
async function importOne(input: {
  readonly agentId: string
  readonly defaultModelId: string | undefined
  readonly provider: AgentProviderSnapshot['providers'][number]
  readonly registryKeyVar: string
  readonly store: AgentConfigStore
}): Promise<ImportFailure | undefined> {
  const { agentId, defaultModelId, provider, registryKeyVar, store } = input

  try {
    const outcome = await store.execCli({
      agentId,
      args: agentProviderCatalogAddArgs({
        providerId: provider.id,
        ...(defaultModelId === undefined ? {} : { defaultModelId }),
        ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
      }),
      secretVar: registryKeyVar,
      secretValue: '',
      catalogDocument: agentProviderImportDocument(provider),
      secretFromGlobalProvider: provider.id,
    })

    return outcome.status === 0 ? undefined : { id: provider.id, reason: reasonOf(outcome) }
  } catch (cause: unknown) {
    return { id: provider.id, reason: describeAgentCliFailure(cause, '调用失败') }
  }
}

/*
 * 改写顶层的 default_model。
 *
 * 官方没有「只改这一个键」的命令 —— CLI 的子命令表里根本没有 config 那一项。唯一会写
 * 这个键的出口是 provider catalog add 的 --default-model，而它对已存在的 id 是先删后
 * 建。所以换一个默认模型，等于拿这一家现有的模型清单重放一次导入，只是这次带上目标。
 *
 * 密钥不经这里：重放要求把这一家的 api_key 再交一次，由原生侧从 agent 自己的配置里取出
 * 直达子进程（secretFromAgentProvider）。渲染层从头到尾没有那个值，用户也不必为了换个
 * 模型重输一遍密钥。
 *
 * 返回 undefined 表示成了；没成返回对方的原话。与 importOne 同一种约定。
 */
async function writeDefaultModel(input: {
  readonly agentId: string
  readonly alias: string
  readonly owner: AgentProviderSnapshot['providers'][number]
  readonly registryKeyVar: string
  readonly store: AgentConfigStore
}): Promise<string | undefined> {
  const { agentId, alias, owner, registryKeyVar, store } = input

  try {
    const outcome = await store.execCli({
      agentId,
      args: agentProviderCatalogAddArgs({
        providerId: owner.id,
        defaultModelId: agentBareModelId(alias, owner.id),
        ...(owner.baseUrl === undefined ? {} : { baseUrl: owner.baseUrl }),
      }),
      secretVar: registryKeyVar,
      secretValue: '',
      catalogDocument: agentProviderImportDocument(owner),
      secretFromAgentProvider: owner.id,
    })

    return outcome.status === 0 ? undefined : reasonOf(outcome)
  } catch (cause: unknown) {
    return describeAgentCliFailure(cause, '改默认模型失败，请重试。')
  }
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
  const [probing, setProbing] = useState(false)
  const [globalSnapshot, setGlobalSnapshot] = useState<AgentProviderSnapshot | undefined>(undefined)
  const [globalNote, setGlobalNote] = useState<string | null>(null)
  const [keyTails, setKeyTails] = useState<Readonly<Record<string, string>>>({})
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importNote, setImportNote] = useState<string | null>(null)
  const [defaultModel, setDefaultModel] = useState<string | null>(null)
  const [defaultModelBusy, setDefaultModelBusy] = useState(false)
  const [defaultModelNote, setDefaultModelNote] = useState<string | null>(null)

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
   * 确认导入：一家一家走官方的 provider catalog add。
   *
   * 不是整份复制 config.toml —— 那件事的前提（受控 home 里现有的都不重要）在任何
   * 一台已配置过的机器上都是假的，原生侧那条命令因此已经删了。官方语义里写入的
   * 原子单位本来就是 provider（catalog add 自己先删再建），所以导入也按 provider 走。
   *
   * 目录由这一家在全局配置里的模型清单现场序列化，密钥由原生侧从全局 config.toml
   * 取出直达子进程 —— 两样都不进渲染层，与厂商卡那条写入是同一条管线。
   *
   * 串行而不是并发：每一次都在改 agent 同一个 config.toml，而那个文件没有跨进程锁。
   *
   * 只导已配置密钥的那几家。没有密钥的那几家取不到 api_key，catalog add 必然失败；
   * 与其让用户看一串错误，不如一开始就不发那几次调用。
   */
  const runImport = useCallback(() => {
    if (importing || globalSnapshot === undefined) {
      return
    }

    if (registryKeyVar === undefined) {
      setImportNote('这个 agent 没有声明该往哪个环境变量注入密钥，无法导入。')
      return
    }

    const usable = globalSnapshot.providers.filter((provider) => provider.configured)

    if (usable.length === 0) {
      setImportNote('全局配置里没有带密钥的 provider 可导入。')
      return
    }

    /*
     * 谁来定 default_model。
     *
     * 顶层没有这一行，ACP 的鉴权闸门第一条就判死，配置文件里的密钥整条不算数。
     * 导入以前不带这个参数，而上游只在旧值还解析得出来时才恢复它
     * （handleCatalogAdd 的 stillResolves）—— 删干净重来的机器上没有旧值可恢复，
     * 于是导完一切都对，就是开不了会话。
     *
     * 只给第一家带：后面几家不带参数时，上游会把刚写进去的这个值原样恢复（它仍在
     * config.models 里，stillResolves 为真）。每家都带只会让最后一家赢，那是随机，
     * 不是选择。
     */
    const defaultModelOwner = usable.find(
      (provider) => agentProviderDefaultModelId(provider) !== undefined,
    )

    setImporting(true)
    setImportNote(null)

    const importAll = async (): Promise<readonly ImportFailure[]> => {
      const failed: ImportFailure[] = []

      /*
       * 串行而不是并发：每一次都在改 agent 同一个 config.toml，而那个文件没有跨
       * 进程锁。一家失败也不中断 —— 逐家记名，最后一次说清楚。
       */
      for (const provider of usable) {
        const failure = await importOne({
          agentId,
          defaultModelId:
            provider === defaultModelOwner ? agentProviderDefaultModelId(provider) : undefined,
          provider,
          registryKeyVar,
          store,
        })

        if (failure !== undefined) {
          failed.push(failure)
        }
      }

      return failed
    }

    void importAll().then(
      (failed) => {
        setImporting(false)
        setImportNote(
          failed.length === 0
            ? `已导入 ${usable.length} 家 provider。`
            : `已导入 ${usable.length - failed.length} 家。` +
                failed.map((one) => `${one.id}：${one.reason}`).join('；'),
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
  }, [agentId, globalSnapshot, importing, providers, registryKeyVar, store])

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

  /*
   * 顶层的 default_model，与密钥尾号同一个时机重取：两样都住在 agent 自己的
   * config.toml 里，快照变了就意味着那个文件被动过。
   */
  useEffect(() => {
    if (providerSnapshot === undefined) {
      setDefaultModel(null)
      return
    }

    let active = true

    void store.loadDefaultModel(agentId).then(
      (alias) => {
        if (active) {
          setDefaultModel(alias)
        }
      },
      () => {
        if (active) {
          setDefaultModel(null)
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
   * 「默认模型」那一格的候选：所有已配置的模型，跨厂商摆在一起。
   *
   * 不是内置表：这一格问的是「agent 现在拿哪个开会话」，只有它自己配着的模型答得了。
   * 值用别名（provider/model 的全名）—— 配置里 default_model 存的就是这个形状，读回来
   * 可以直接比，不必在两种写法之间来回换算。
   */
  const defaultModelOptions = useMemo<readonly (readonly [string, string])[]>(() => {
    return allModels.map((model) => [model.alias, agentModelDisplayName(model)] as const)
  }, [allModels])

  /*
   * 那一格左边说什么。三种情况，第二种不是假想：删掉一家 provider 会带走它的模型，而
   * 对方只在别名仍解析得出来时才保留 default_model —— 指着一个不存在的别名是真实的
   * 中间态，它的表现就是下一次开会话报 Authentication required。
   */
  const defaultModelLabel = useMemo(() => {
    if (defaultModel === null) {
      return '未设置 —— agent 开不了会话，先选一个'
    }

    if (!defaultModelOptions.some(([alias]) => alias === defaultModel)) {
      return `配置里写着 ${defaultModel}，但这个模型已经不在了`
    }

    return '开会话时用它'
  }, [defaultModel, defaultModelOptions])

  /*
   * 拨动即写入。没有「保存」按钮：这一格背后是一次命令调用，不是一份待提交的表单 ——
   * 上一版那三个下拉之所以是装饰，正因为它们只在提交密钥时才被读一眼。
   *
   * 先把界面切过去、失败再切回来，与「智能体」那一行同一套做法。回滚用的是拨动前的
   * 那个值，不是「默认值」。
   */
  const selectDefaultModel = useCallback(
    (alias: string) => {
      if (defaultModelBusy) {
        return
      }

      const owner = providers.snapshot?.providers.find((provider) => {
        return provider.models.some((model) => model.alias === alias)
      })

      if (owner === undefined) {
        setDefaultModelNote('这个模型不属于任何已配置的 provider。')
        return
      }

      if (registryKeyVar === undefined) {
        setDefaultModelNote('这个 agent 没有声明该往哪个环境变量注入密钥，改不了默认模型。')
        return
      }

      const previous = defaultModel

      setDefaultModel(alias)
      setDefaultModelBusy(true)
      setDefaultModelNote(null)

      void writeDefaultModel({ agentId, alias, owner, registryKeyVar, store }).then(
        (reason) => {
          setDefaultModelBusy(false)

          if (reason !== undefined) {
            setDefaultModel(previous)
            setDefaultModelNote(reason)
            return
          }

          providers.reload()
        },
        (cause: unknown) => {
          setDefaultModelBusy(false)
          setDefaultModel(previous)
          setDefaultModelNote(describeAgentCliFailure(cause, '改默认模型失败，请重试。'))
        },
      )
    },
    [agentId, defaultModel, defaultModelBusy, providers, registryKeyVar, store],
  )

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
          <div className="models-block">
            <span className="models-block__label">默认模型</span>

            <div className="models-card">
              <div className="models-row models-row--field">
                <span className="models-row__name">{defaultModelLabel}</span>

                <div className="models-row__control">
                  {defaultModelBusy ? <InlineSpinner /> : null}

                  {defaultModelOptions.length > 0 ? (
                    <OptionSelect
                      ariaLabel="默认模型"
                      onChange={selectDefaultModel}
                      options={defaultModelOptions}
                      value={defaultModel ?? ''}
                    />
                  ) : (
                    <span className="models-row__meta">还没有可选的模型</span>
                  )}
                </div>
              </div>
            </div>

            {defaultModelNote !== null ? <p className="models-empty">{defaultModelNote}</p> : null}
          </div>

          {BUILTIN_PROVIDERS.map((preset) => (
            <ProviderKeyCard
              agentId={agentId}
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
      <span className="models-row__name">{agentModelDisplayName(model)}</span>

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
