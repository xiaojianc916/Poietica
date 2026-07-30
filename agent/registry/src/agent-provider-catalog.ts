/*
 * agent 的 provider 目录（catalog）。
 *
 * 产地只有一个：agent 官方 CLI 的 provider catalog list <providerId> --json，背后是
 * models.dev。这里不存目录、不存模型名表 —— 自己维护一份厂商→模型名的表，等于把上游
 * 的发布节奏抄进我们的版本号：对方上一个新模型，用户要等我们发版才选得到。
 *
 * 「填了 key 就自动认出是哪家」这条路不通，不是没想到：providers.md 里 kimi 与 openai
 * 两处示例的 key 逐字相同都是 sk-xxxxx，DeepSeek / Qwen 也共用 openai 协议。前缀不是
 * 契约。要真「确认」只能拿 key 去打对方的 /v1/models，那就是直连 Provider，与既定决策
 * 相反。业界标杆也是点选：Zed 的 llm-providers 是一张清单，kimi 自己的 /provider 流程
 * 逐字是 select a provider → enter an API key → select a default model。
 *
 * 输出形状是个诚实的未知：上游只承诺 --json，没给 schema，我们也还没实测。所以归一集中
 * 在 entriesOf / providerNode 两处，三种可能形状（数组、id→对象的表、{ providers } 包裹）
 * 走同一段代码，字段一律白名单取，取不到就跳过并记 issue —— 不猜、不外推，失败可见。
 *
 * 密钥永远不出现在这里返回的任何一个 arg 里。原生侧的 FORBIDDEN_FLAGS 会拒掉 --api-key，
 * 因为 Windows 上任何用户都读得到别的进程的完整命令行。密钥走 KIMI_REGISTRY_API_KEY 这
 * 类环境变量注入，变量名记在 agent 档案的 registryKeyVar 里。
 */

const MAX_TEXT = 512
const MAX_MODELS = 512

/*
 * 能安全出现在命令行上的参数。
 *
 * 收得比 shell 严：这些值最终会被原生侧再校验一次（contains_metacharacter），在这里先
 * 拦一次是为了让错误发生在看得见的地方，而不是变成一句 IPC 报错。
 */
const ARG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/

export interface AgentCatalogModel {
  readonly id: string
  readonly displayName: string
  /** 目录没给就是 undefined。不编一个默认值 —— 那会显示成一个假的上下文窗口。 */
  readonly maxContextSize: number | undefined
}

export interface AgentCatalogModels {
  readonly models: readonly AgentCatalogModel[]
  readonly issues: readonly string[]
}

export interface AgentProviderCatalogAdd {
  readonly providerId: string
  readonly defaultModelId?: string | undefined
  /** 留空表示用目录里自带的 endpoint。目录没有 endpoint 时对方会要求必填。 */
  readonly baseUrl?: string | undefined
}

function requireArg(value: string, what: string): string {
  if (!ARG_PATTERN.test(value)) {
    throw new Error(`${what}含有不能出现在命令行上的字符：${value}`)
  }

  return value
}

/** 问某一家有哪些模型。带 providerId 时对方会连模型一起列出来。 */
export function agentProviderCatalogModelsArgs(providerId: string): readonly string[] {
  return ['provider', 'catalog', 'list', requireArg(providerId, '厂商标识'), '--json']
}

/**
 * 从目录里添加一家 provider。
 *
 * 协议类型、base URL 与模型信息全部由目录提供，我们只补一个密钥 —— 而密钥不在这串参数
 * 里，也不可能被加进来：这个函数根本没有接收它的形参。
 */
export function agentProviderCatalogAddArgs(input: AgentProviderCatalogAdd): readonly string[] {
  const args: string[] = ['provider', 'catalog', 'add', requireArg(input.providerId, '厂商标识')]

  if (input.defaultModelId !== undefined && input.defaultModelId.length > 0) {
    args.push('--default-model', requireArg(input.defaultModelId, '模型标识'))
  }

  if (input.baseUrl !== undefined && input.baseUrl.length > 0) {
    args.push('--base-url', requireArg(input.baseUrl, '基础地址'))
  }

  return args
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined
  }

  return input as Record<string, unknown>
}

function asText(input: unknown, max = MAX_TEXT): string | undefined {
  if (typeof input !== 'string' || input.length === 0 || input.length > max) {
    return undefined
  }

  return input
}

function asCount(input: unknown): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return undefined
  }

  return Math.floor(input)
}

/*
 * 把「一串条目」归一成 [id, 对象] 列表。
 *
 * 数组形状里 id 是条目自己的字段，表形状里 id 是键。两种都出现在 models.dev 与 CLI 输出
 * 的不同层级上，所以归一只写一次。
 */
function entriesOf(input: unknown): Array<readonly [string, Record<string, unknown>]> {
  const entries: Array<readonly [string, Record<string, unknown>]> = []

  if (Array.isArray(input)) {
    for (const item of input) {
      const raw = asRecord(item)

      if (raw === undefined) {
        continue
      }

      const id = asText(raw['id'], 128)

      if (id === undefined) {
        continue
      }

      entries.push([id, raw] as const)
    }

    return entries
  }

  const table = asRecord(input)

  if (table === undefined) {
    return entries
  }

  for (const [key, value] of Object.entries(table)) {
    const id = asText(key, 128)

    if (id === undefined) {
      continue
    }

    entries.push([id, asRecord(value) ?? {}] as const)
  }

  return entries
}

function contextOf(raw: Record<string, unknown>): number | undefined {
  const limit = asRecord(raw['limit'])

  return (
    asCount(raw['maxContextSize']) ?? asCount(limit?.['context']) ?? asCount(raw['contextWindow'])
  )
}

function modelsFrom(input: unknown): AgentCatalogModel[] {
  const models: AgentCatalogModel[] = []

  for (const [id, raw] of entriesOf(input).slice(0, MAX_MODELS)) {
    models.push({
      id,
      displayName: asText(raw['name'], 128) ?? asText(raw['displayName'], 128) ?? id,
      maxContextSize: contextOf(raw),
    })
  }

  models.sort((left, right) => left.displayName.localeCompare(right.displayName))

  return models
}

function pick(input: unknown, providerId: string): Record<string, unknown> | undefined {
  if (Array.isArray(input)) {
    for (const item of input) {
      const raw = asRecord(item)

      if (raw !== undefined && asText(raw['id'], 128) === providerId) {
        return raw
      }
    }

    return undefined
  }

  const table = asRecord(input)

  if (table === undefined) {
    return undefined
  }

  return asRecord(table[providerId])
}

function providerNode(input: unknown, providerId: string): Record<string, unknown> | undefined {
  const raw = asRecord(input)

  if (raw === undefined) {
    return undefined
  }

  return pick(raw['providers'], providerId) ?? pick(raw, providerId)
}

function decode(stdout: string): { readonly value: unknown } | { readonly issue: string } {
  const text = stdout.trim()

  if (text.length === 0) {
    return { issue: 'agent 没有输出目录内容' }
  }

  try {
    return { value: JSON.parse(text) as unknown }
  } catch {
    return { issue: '目录输出不是合法的 JSON' }
  }
}

/**
 * 解析「某一家有哪些模型」。
 *
 * 三处依次找：这家 provider 节点下的 models、顶层 providers 表里这一家、顶层 models。
 * 找不到不抛错也不编空清单成功 —— 记一条 issue，界面会把它显示出来。
 */
export function parseAgentProviderCatalogModelsOutput(
  stdout: string,
  providerId: string,
): AgentCatalogModels {
  const decoded = decode(stdout)

  if ('issue' in decoded) {
    return { models: [], issues: [decoded.issue] }
  }

  const node = providerNode(decoded.value, providerId)
  const scoped = node === undefined ? [] : modelsFrom(node['models'])

  if (scoped.length > 0) {
    return { models: scoped, issues: [] }
  }

  const top = asRecord(decoded.value)
  const direct = top === undefined ? [] : modelsFrom(top['models'])

  if (direct.length > 0) {
    return { models: direct, issues: [] }
  }

  return { models: [], issues: ['agent 没有报出这家厂商的模型'] }
}
