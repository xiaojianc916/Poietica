import type { AgentProviderState } from './agent-provider-state'

/*
 * 内置厂商清单。
 *
 * 为什么是内置的：agent 的目录命令（kimi provider catalog list/add）每次都要现拉
 * models.dev，拉不到就 exit 1 —— 它没有内置兜底（apps/kimi-code/src/cli/sub/provider.ts
 * 的 loadCatalogOrExit）。在拿不到 models.dev 的网络里，那条路整条不通，不只是某一家。
 *
 * 业界标杆也是内置的：Zed 的 crates/language_models/src/provider/deepseek.rs 在
 * provided_models() 里直接 models.insert("deepseek-v4-flash" / "deepseek-v4-pro")，
 * 再叠加用户在 settings 里追加的 available_models。内置 + 可追加，两层。
 *
 * 代价是会过时，这个代价是真的：DeepSeek 的 deepseek-chat / deepseek-reasoner 两个
 * 别名已于 2026-07-24 停用，Zed 里也已经删掉了。所以每条模型都注明证据来源，改的时候
 * 回去核，而不是照着记忆改。治本的来源是各家的 GET /models 端点，那是下一刀的事。
 *
 * 这里不放密钥，一个字节都不放。密钥经环境变量交给 agent，写入由它自己完成。
 */

/** 协议。取值必须是 agent 认的那几种，不是我们自己起的名字。 */
export type AgentProviderWire = 'openai' | 'anthropic' | 'kimi'

export interface AgentProviderPresetModel {
  /** 原样交给对方 API 的 model id。大小写与连字符都不能改。 */
  readonly id: string
  readonly displayName: string
  /** 上下文窗口，只在有明确出处时才填。取不到就缺席，不估。 */
  readonly maxContextSize?: number
}

export interface AgentProviderPreset {
  /** 写进 agent 配置时用的 provider 标识。 */
  readonly id: string
  readonly displayName: string
  readonly description: string
  readonly wire: AgentProviderWire
  /** 接口地址。内置默认，不给用户手填 —— Zed 的 api_url() 也是这个形状。 */
  readonly baseUrl: string
  /** 去哪里申请密钥。照 Zed 的 ApiKeyConfiguration 第四个参数。 */
  readonly apiKeysUrl: string
  readonly models: readonly AgentProviderPresetModel[]
}

/*
 * DeepSeek
 * 协议：OpenAI Chat Completions。kimi-code 的 providers.md 在 openai 那一行逐字写着
 *   「OpenAI and compatible services, DeepSeek, Qwen, etc.」
 * base URL：官方文档 base_url (OpenAI) = https://api.deepseek.com
 * 模型：Zed 的 provided_models() 逐字两条，与官方变更日志一致。
 * 上下文：Zed 的 crates/deepseek/src/deepseek.rs 逐字 —— V4Flash | V4Pro => 1_000_000。
 * 这一格不能缺席：对方的目录解析器把没有 limit.context 的模型整条丢掉
 * （kosong/src/catalog.ts 的 catalogModelToCapability）。
 */
const DEEPSEEK: AgentProviderPreset = {
  id: 'deepseek',
  displayName: 'DeepSeek',
  description: '填入 DeepSeek 平台密钥，按用量直接计费到该账号。',
  wire: 'openai',
  baseUrl: 'https://api.deepseek.com',
  apiKeysUrl: 'https://platform.deepseek.com/api_keys',
  models: [
    { id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', maxContextSize: 1000000 },
    { id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', maxContextSize: 1000000 },
  ],
}

/*
 * 智谱 GLM
 * base URL 与模型 id：官方 GLM-5.2 文档页的 cURL 示例逐字 ——
 *   POST https://open.bigmodel.cn/api/paas/v4/chat/completions，"model": "glm-5.2"
 * glm-4.6 取自文档页路径 /cn/guide/models/text/glm-4.6 与多方配置示例。
 *
 * GLM-5.1 / GLM-5 / GLM-4.7 只在「模型概览」里拿到展示名，没有拿到调用示例里的
 * 模型编码，所以不写 —— 少一项好过错一项。
 *
 * 注：Coding Plan 套餐另有 /api/coding/paas/v4 与 /api/anthropic 两个入口。等确认你
 * 用的是哪种账号再加，现在不猜。
 */
const ZHIPU: AgentProviderPreset = {
  id: 'zhipu',
  displayName: '智谱 GLM',
  description: '填入智谱开放平台密钥，走 OpenAI 兼容接口。',
  wire: 'openai',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  apiKeysUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
  models: [
    { id: 'glm-5.2', displayName: 'GLM-5.2', maxContextSize: 1000000 },
    { id: 'glm-4.6', displayName: 'GLM-4.6', maxContextSize: 200000 },
  ],
}

/*
 * Kimi（Moonshot 平台密钥）
 * 协议与 base URL：providers.md 的 kimi 段逐字 —— 默认 base_url
 *   https://api.moonshot.ai/v1，OpenAI 兼容。
 * 模型：Kimi 开放平台模型列表页逐字。上下文取该页写明的数字。
 *
 * id 不叫 kimi：agent 自己的配置里 kimi 这个 provider 是它的托管服务（/login 走
 * OAuth）。同名导入会把那一条替换掉 —— catalog add 对已存在的 id 是先删再建。
 */
const MOONSHOT: AgentProviderPreset = {
  id: 'moonshot',
  displayName: 'Kimi（Moonshot 平台）',
  description: '填入 Kimi 开放平台密钥。托管账号请用 agent 自己的登录，不走这里。',
  wire: 'kimi',
  baseUrl: 'https://api.moonshot.ai/v1',
  apiKeysUrl: 'https://platform.kimi.com/',
  models: [
    { id: 'kimi-k3', displayName: 'Kimi K3', maxContextSize: 1000000 },
    { id: 'kimi-k2.7-code', displayName: 'Kimi K2.7 Code', maxContextSize: 256000 },
    {
      id: 'kimi-k2.7-code-highspeed',
      displayName: 'Kimi K2.7 Code 高速版',
      maxContextSize: 256000,
    },
    { id: 'kimi-k2.6', displayName: 'Kimi K2.6', maxContextSize: 256000 },
    { id: 'kimi-k2.5', displayName: 'Kimi K2.5', maxContextSize: 256000 },
  ],
}

const PRESETS: readonly AgentProviderPreset[] = [DEEPSEEK, ZHIPU, MOONSHOT]

/** 设置界面要显示的厂商，顺序即显示顺序。 */
export function builtinAgentProviders(): readonly AgentProviderPreset[] {
  return PRESETS
}

/** 按 id 取一家。取不到返回 undefined，不兜底成第一家。 */
export function builtinAgentProviderById(id: string): AgentProviderPreset | undefined {
  return PRESETS.find((preset) => preset.id === id)
}

/*
 * 把内置表序列化成 agent 目录命令认的 api.json 形状。
 *
 * 形状的判据是对方解析器逐字读什么（@moonshot-ai/kosong 的 src/catalog.ts）：顶层是
 * id → 厂商的表；厂商条目里 type 是显式协议（在场就以它为准）、api 是接口地址、models
 * 是 id → 模型的表；模型条目里 id 与 limit.context 是硬门槛 —— 缺一个正整数 context，
 * 那条模型就被对方整条丢掉（catalogModelToCapability）。name 只是显示名。除此之外的
 * 字段（env、npm、cost…）没有证据的一律不写。
 *
 * 产物经 IPC 交给原生侧，绑在一次性 loopback 服务上，经官方 --url 喂给 catalog add。
 * 不含密钥：密钥走环境变量，从来不进这份文档。
 */
export function agentProviderCatalogDocument(presets: readonly AgentProviderPreset[]): string {
  const catalog: Record<string, unknown> = {}

  for (const preset of presets) {
    const models: Record<string, unknown> = {}

    for (const model of preset.models) {
      models[model.id] = {
        id: model.id,
        name: model.displayName,
        ...(model.maxContextSize === undefined ? {} : { limit: { context: model.maxContextSize } }),
      }
    }

    catalog[preset.id] = {
      id: preset.id,
      name: preset.displayName,
      api: preset.baseUrl,
      type: preset.wire,
      models,
    }
  }

  return JSON.stringify(catalog)
}

/*
 * 剥掉别名的 provider/ 前缀。--default-model 只认裸模型 id：对方的校验名单是
 * catalogProviderModels，里面的 id 没有前缀。别名取不到前缀时原样用。
 */
function bareModelId(alias: string, providerId: string): string {
  const prefix = `${providerId}/`

  return alias.startsWith(prefix) ? alias.slice(prefix.length) : alias
}

/*
 * 一张厂商卡的模型下拉选项。
 *
 * 候选的产地按优先级只有一个答案：这家已经在 agent 里配过，就以 provider list 的
 * 快照为准 —— 那是 agent 此刻的真实配置；否则用内置表兜底。两边都只给 [id, 显示名]：
 * id 原样交给 --default-model 校验，显示名给人看。
 */
export function agentProviderModelOptions(
  preset: AgentProviderPreset,
  configured: AgentProviderState | undefined,
): readonly (readonly [string, string])[] {
  const source =
    configured !== undefined && configured.models.length > 0
      ? configured.models.map(
          (model) => [bareModelId(model.alias, configured.id), model.displayName] as const,
        )
      : preset.models.map((model) => [model.id, model.displayName] as const)

  /* 同一家配两次（先内置目录、后自定义注册表）会留下重复别名，去重而不是让下拉出现两行一样的。 */
  const seen = new Set<string>()
  const options: Array<readonly [string, string]> = []

  for (const option of source) {
    if (!seen.has(option[0])) {
      seen.add(option[0])
      options.push(option)
    }
  }

  return options
}
