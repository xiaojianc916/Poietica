/**
 * models.dev 模型目录。
 *
 * 联网拉取，缓存落在 agents.json。目录不是权威 —— 权威永远是 agent 在
 * session/new 与 session/load 时报回来的 configOptions。这份目录只回答一个
 * 问题：配置界面上该给用户列出哪些候选模型。
 *
 * 解析刻意写得极其宽容：models.dev 的字段会演进，而一个多出来或少掉的字段
 * 不该让整个设置页白屏。缺字段就降级成 undefined，界面少显示一列而已。
 */

/** 目录里的一个模型。除 id 与 name 外全部可缺。 */
export interface CatalogModel {
  readonly id: string
  readonly name: string
  /** 上下文窗口大小（token）。取不到就是 undefined。 */
  readonly contextWindow?: number | undefined
  readonly maxOutput?: number | undefined
  readonly reasoning?: boolean | undefined
  readonly toolCall?: boolean | undefined
  readonly releaseDate?: string | undefined
}

/** 目录里的一个提供方。 */
export interface CatalogProvider {
  readonly id: string
  readonly name: string
  /** 该提供方约定的环境变量名，例如 ['DEEPSEEK_API_KEY']。 */
  readonly env: readonly string[]
  readonly baseUrl?: string | undefined
  readonly doc?: string | undefined
  readonly models: readonly CatalogModel[]
}

export interface ModelCatalog {
  readonly providers: readonly CatalogProvider[]
  readonly fetchedAt: string
}

export const MODELS_DEV_URL = 'https://models.dev/api.json'

const FETCH_TIMEOUT_MS = 15_000

function asRecord(input: unknown): Record<string, unknown> | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined
  }

  return input as Record<string, unknown>
}

function asText(input: unknown): string | undefined {
  return typeof input === 'string' && input.length > 0 ? input : undefined
}

function asCount(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : undefined
}

function asFlag(input: unknown): boolean | undefined {
  return typeof input === 'boolean' ? input : undefined
}

function asTextList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return []
  }

  const list: string[] = []

  for (const candidate of input) {
    const value = asText(candidate)

    if (value !== undefined && !list.includes(value)) {
      list.push(value)
    }
  }

  return list
}

function parseModel(id: string, input: unknown): CatalogModel | undefined {
  const raw = asRecord(input)

  if (!raw) {
    return undefined
  }

  const limit = asRecord(raw['limit']) ?? {}

  return {
    id: asText(raw['id']) ?? id,
    name: asText(raw['name']) ?? id,
    contextWindow: asCount(limit['context']),
    maxOutput: asCount(limit['output']),
    reasoning: asFlag(raw['reasoning']),
    toolCall: asFlag(raw['tool_call']),
    releaseDate: asText(raw['release_date']),
  }
}

function parseProvider(id: string, input: unknown): CatalogProvider | undefined {
  const raw = asRecord(input)

  if (!raw) {
    return undefined
  }

  const rawModels = asRecord(raw['models'])

  if (!rawModels) {
    return undefined
  }

  const models: CatalogModel[] = []

  for (const [modelId, candidate] of Object.entries(rawModels)) {
    const model = parseModel(modelId, candidate)

    if (model !== undefined) {
      models.push(model)
    }
  }

  if (models.length === 0) {
    return undefined
  }

  return {
    id: asText(raw['id']) ?? id,
    name: asText(raw['name']) ?? id,
    env: asTextList(raw['env']),
    baseUrl: asText(raw['api']),
    doc: asText(raw['doc']),
    models,
  }
}

/**
 * 解析 models.dev 的响应体。
 *
 * 顶层是 providerId 到 provider 的映射。解析不出来的条目直接跳过，不抛错：
 * 目录是外部数据，一个坏条目不该让整份目录不可用。
 */
export function parseModelCatalog(input: unknown, fetchedAt: string): ModelCatalog {
  const raw = asRecord(input)

  if (!raw) {
    return { providers: [], fetchedAt }
  }

  const providers: CatalogProvider[] = []

  for (const [providerId, candidate] of Object.entries(raw)) {
    const provider = parseProvider(providerId, candidate)

    if (provider !== undefined) {
      providers.push(provider)
    }
  }

  providers.sort((left, right) => left.name.localeCompare(right.name))

  return { providers, fetchedAt }
}

/**
 * 联网拉取模型目录。
 *
 * 失败时抛错，由调用方决定是回退到缓存还是提示用户 —— 这里不做静默降级，
 * 因为「目录是旧的」和「目录拉取失败了」对用户是两件不同的事。
 */
export async function fetchModelCatalog(url = MODELS_DEV_URL): Promise<ModelCatalog> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      throw new Error(['模型目录返回 HTTP', String(response.status)].join(' '))
    }

    return parseModelCatalog(await response.json(), new Date().toISOString())
  } finally {
    clearTimeout(timer)
  }
}

/** 从目录里挑出一个提供方。 */
export function catalogProviderById(
  catalog: ModelCatalog,
  providerId: string,
): CatalogProvider | undefined {
  return catalog.providers.find((provider) => provider.id === providerId)
}
