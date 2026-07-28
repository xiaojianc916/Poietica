/**
 * 模型提供方档案。
 *
 * 这不是"客户端要去调用的 API"——我们从不直连 provider。它描述的是：
 * 当我们启动一个 ACP agent 时，应该把哪个 base URL、哪个密钥、哪个默认模型
 * 注入到它的环境变量里。真正发请求的永远是 agent 进程。
 *
 * 只支持两种主流方言，因为客户端不做协议转译：
 *   - anthropic:   Claude Code 兼容端点（智谱 GLM、Kimi、百炼等都提供）
 *   - openai-chat: OpenAI Chat Completions 兼容端点（DeepSeek、OpenAI 等）
 *
 * Codex 走 Responses API、Gemini 走自家协议，都需要额外适配，因此它们的
 * agent 档案不绑定提供方，由 agent 自行认证。
 */
export type ModelProviderDialect = 'anthropic' | 'openai-chat'

/** 一个方言默认使用的环境变量名。可以在 agent 档案里改写。 */
export interface ProviderEnvNames {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}

export interface ModelProviderProfile {
  readonly id: string
  readonly displayName: string
  readonly dialect: ModelProviderDialect
  readonly baseUrl: string
  /** 我认识的模型 id。会腐烂，所以可增删。 */
  readonly models: readonly string[]
  /**
   * 打开的模型。
   *
   * 语义是"在模型选择器里出现并靠前"，不是"授权使用"：能不能用某个模型只有
   * agent 说了算（ACP 的 configOptions 才是真值），客户端假装有否决权只会
   * 制造"我打开了却用不了"。借用 Zed 的 favorite_config_option_values。
   */
  readonly favoriteModels: readonly string[]
  /** 启动 agent 时注入的默认模型。留空则完全交给 agent 的默认值。 */
  readonly defaultModel?: string | undefined
}

export type ModelProviderProfileParse =
  | { readonly ok: true; readonly profile: ModelProviderProfile }
  | { readonly ok: false; readonly issue: string }

type Parsed<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly issue: string }

const ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
const MAX_MODELS = 128
const MAX_TEXT = 512

export function defaultEnvNames(dialect: ModelProviderDialect): ProviderEnvNames {
  if (dialect === 'anthropic') {
    return {
      apiKey: 'ANTHROPIC_AUTH_TOKEN',
      baseUrl: 'ANTHROPIC_BASE_URL',
      model: 'ANTHROPIC_MODEL',
    }
  }

  return {
    apiKey: 'OPENAI_API_KEY',
    baseUrl: 'OPENAI_BASE_URL',
    model: 'OPENAI_MODEL',
  }
}

function fail(issue: string): { readonly ok: false; readonly issue: string } {
  return { ok: false, issue }
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

function parseIdList(input: unknown, max: number): Parsed<string[]> {
  if (input === undefined) {
    return { ok: true, value: [] }
  }

  if (!Array.isArray(input) || input.length > max) {
    return fail(`清单必须是字符串数组，且不超过 ${max} 项`)
  }

  const list: string[] = []

  for (const candidate of input) {
    const value = asText(candidate, 128)

    if (value === undefined) {
      return fail('清单里的每一项都必须是非空字符串')
    }

    if (!list.includes(value)) {
      list.push(value)
    }
  }

  return { ok: true, value: list }
}

/** base URL 必须是 http(s)，否则密钥可能被发到意外的地方。 */
function parseHttpUrl(input: unknown): Parsed<string> {
  const text = asText(input, 1024)

  if (text === undefined) {
    return fail('base URL 不能为空')
  }

  try {
    const url = new URL(text)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return fail('base URL 必须是 http 或 https 地址')
    }

    return { ok: true, value: text }
  } catch {
    return fail('base URL 不是合法的地址')
  }
}

function parseIdentity(
  raw: Record<string, unknown>,
): Parsed<{ readonly id: string; readonly displayName: string }> {
  const id = asText(raw['id'], 32)

  if (id === undefined || !ID_PATTERN.test(id)) {
    return fail('提供方标识只允许小写字母、数字与连字符，且以字母开头')
  }

  const displayName = asText(raw['displayName'], 64)

  if (displayName === undefined) {
    return fail('提供方需要一个 1–64 字的名称')
  }

  return { ok: true, value: { id, displayName } }
}

function parseDefaultModel(input: unknown): Parsed<string | undefined> {
  if (input === undefined || input === null) {
    return { ok: true, value: undefined }
  }

  const value = asText(input, 128)

  if (value === undefined) {
    return fail('默认模型必须是非空字符串')
  }

  return { ok: true, value }
}

export function parseModelProviderProfile(input: unknown): ModelProviderProfileParse {
  const raw = asRecord(input)

  if (!raw) {
    return fail('提供方档案必须是对象')
  }

  const identity = parseIdentity(raw)

  if (!identity.ok) {
    return identity
  }

  if (raw['dialect'] !== 'anthropic' && raw['dialect'] !== 'openai-chat') {
    return fail('只支持 anthropic 与 openai-chat 两种方言')
  }

  const baseUrl = parseHttpUrl(raw['baseUrl'])

  if (!baseUrl.ok) {
    return baseUrl
  }

  const models = parseIdList(raw['models'], MAX_MODELS)

  if (!models.ok) {
    return models
  }

  const favoriteModels = parseIdList(raw['favoriteModels'], MAX_MODELS)

  if (!favoriteModels.ok) {
    return favoriteModels
  }

  const defaultModel = parseDefaultModel(raw['defaultModel'])

  if (!defaultModel.ok) {
    return defaultModel
  }

  return {
    ok: true,
    profile: {
      id: identity.value.id,
      displayName: identity.value.displayName,
      dialect: raw['dialect'],
      baseUrl: baseUrl.value,
      models: models.value,
      favoriteModels: favoriteModels.value,
      defaultModel: defaultModel.value,
    },
  }
}

/**
 * 内置提供方种子。
 *
 * 这些模型 id 一定会过期，所以它们只是起手清单，不是真理：界面可以增删，
 * 后续也会把 agent 在会话里报出来的模型 id 自动收进来。
 *
 * 界面用这份种子里的 baseUrl 作为"默认地址"，用来判断当前是否处于覆盖状态，
 * 以及提供"还原默认"。因此这个函数必须是纯的，且每次返回同样的值。
 */
export function builtinModelProviders(): readonly ModelProviderProfile[] {
  return [
    {
      id: 'anthropic',
      displayName: 'Anthropic',
      dialect: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
      favoriteModels: ['claude-sonnet-4-5'],
      defaultModel: undefined,
    },
    {
      id: 'zhipu',
      displayName: '智谱 GLM',
      dialect: 'anthropic',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      models: ['glm-4.6', 'glm-4.5-air'],
      favoriteModels: ['glm-4.6'],
      defaultModel: undefined,
    },
    {
      id: 'moonshot',
      displayName: 'Moonshot Kimi',
      dialect: 'anthropic',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      models: ['kimi-k2-turbo-preview'],
      favoriteModels: [],
      defaultModel: undefined,
    },
    {
      id: 'openai',
      displayName: 'OpenAI',
      dialect: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-5.1', 'gpt-5.1-mini'],
      favoriteModels: [],
      defaultModel: undefined,
    },
    {
      id: 'deepseek',
      displayName: 'DeepSeek',
      dialect: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      favoriteModels: ['deepseek-chat'],
      defaultModel: undefined,
    },
  ]
}

/** 某个提供方的内置默认 base URL。自定义提供方没有默认值。 */
export function builtinBaseUrl(providerId: string): string | undefined {
  return builtinModelProviders().find((provider) => provider.id === providerId)?.baseUrl
}
