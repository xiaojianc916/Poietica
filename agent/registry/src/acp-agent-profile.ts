import { acpAgents, defaultAcpAgent } from './acp-agents'
import { defaultEnvNames, type ModelProviderDialect } from './model-provider-profile'

/** 会话配置值。对应 ACP 的 ConfigOption currentValue（string | boolean）。 */
export type AgentConfigOptionValue = string | boolean

/**
 * 把某个提供方的凭据注入到这个 agent 的哪几个环境变量。
 *
 * 不写 agent 自己的配置文件（~/.claude/settings.json 之类）：那些文件格式各异、
 * 会被 agent 重写，而且会把密钥明文落盘。我们只在 spawn 的瞬间注入环境变量，
 * 这也是 Zed 对 Gemini CLI 的做法。
 */
export interface AgentCredentialBinding {
  readonly providerId: string
  readonly apiKeyEnv: string
  readonly baseUrlEnv: string
  /** 留空表示不注入默认模型，完全交给 agent。 */
  readonly modelEnv?: string | undefined
}

/**
 * 一个 ACP agent 的接入档案。
 *
 * 字段与 Zed 的 CustomAgentServerSettings 对齐：进程怎么起（command/args/env）、
 * 以及会话配置的默认值（defaultConfigOptions）。
 *
 * 这里刻意没有"收藏了哪些模型"：那份状态只存在提供方档案里一处。同一个概念
 * 存两份，迟早会分叉成两个都不敢信的来源。
 *
 * 也没有"支持哪些模型"，因为那是会话在 session/new 之后才报告的事。
 */
export interface AcpAgentProfile {
  readonly id: string
  readonly displayName: string
  /** 可执行文件名或绝对路径。不经 shell，因此不接受元字符。 */
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string | undefined
  /** 非敏感环境变量，会原样落盘。密钥不要写在这里。 */
  readonly env: Readonly<Record<string, string>>
  readonly credentialBinding?: AgentCredentialBinding | undefined
  readonly defaultConfigOptions: Readonly<Record<string, AgentConfigOptionValue>>
}

export interface AcpAgentProfileSet {
  readonly profiles: readonly AcpAgentProfile[]
  readonly defaultProfileId: string
}

export type AcpAgentProfileParse =
  | { readonly ok: true; readonly profile: AcpAgentProfile }
  | { readonly ok: false; readonly issue: string }

/** 容错解析的结果：坏条目被丢弃并汇报，好条目照常可用。 */
export interface AcpAgentProfileSetParse {
  readonly value: AcpAgentProfileSet
  readonly issues: readonly string[]
}

type Parsed<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly issue: string }

const ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/
const SHELL_METACHARACTERS = /[;&|<>$`\n\r"']/

const MAX_ARGS = 32
const MAX_TEXT = 512
const MAX_ENTRIES = 32
const MAX_PROFILES = 32

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

function asEnvName(input: unknown): string | undefined {
  const name = asText(input, 64)

  if (name === undefined || !ENV_NAME_PATTERN.test(name)) {
    return undefined
  }

  return name
}

function parseIdentity(
  raw: Record<string, unknown>,
): Parsed<{ readonly id: string; readonly displayName: string }> {
  const id = asText(raw.id, 32)

  if (id === undefined || !ID_PATTERN.test(id)) {
    return fail('agent 标识只允许小写字母、数字与连字符，且以字母开头')
  }

  const displayName = asText(raw.displayName, 64)

  if (displayName === undefined) {
    return fail('agent 需要一个 1–64 字的名称')
  }

  return { ok: true, value: { id, displayName } }
}

function parseCommand(input: unknown): Parsed<string> {
  const command = asText(input, 256)

  if (command === undefined) {
    return fail('启动命令不能为空')
  }

  if (SHELL_METACHARACTERS.test(command)) {
    return fail('启动命令不经 shell 执行，不能包含 ; & | < > $ 等字符')
  }

  return { ok: true, value: command }
}

function parseArgs(input: unknown): Parsed<string[]> {
  if (input === undefined) {
    return { ok: true, value: [] }
  }

  if (!Array.isArray(input) || input.length > MAX_ARGS) {
    return fail(`参数必须是数组，且不超过 ${MAX_ARGS} 项`)
  }

  const args: string[] = []

  for (const candidate of input) {
    const arg = asText(candidate)

    if (arg === undefined) {
      return fail('参数必须是非空字符串')
    }

    args.push(arg)
  }

  return { ok: true, value: args }
}

function parseCwd(input: unknown): Parsed<string | undefined> {
  if (input === undefined || input === null) {
    return { ok: true, value: undefined }
  }

  const cwd = asText(input, 1024)

  if (cwd === undefined) {
    return fail('工作目录必须是非空字符串')
  }

  return { ok: true, value: cwd }
}

function parseEnv(input: unknown): Parsed<Record<string, string>> {
  if (input === undefined) {
    return { ok: true, value: {} }
  }

  const raw = asRecord(input)

  if (!raw) {
    return fail('环境变量必须是对象')
  }

  const entries = Object.entries(raw)

  if (entries.length > MAX_ENTRIES) {
    return fail(`环境变量不超过 ${MAX_ENTRIES} 项`)
  }

  const env: Record<string, string> = {}

  for (const [name, value] of entries) {
    if (!ENV_NAME_PATTERN.test(name)) {
      return fail(`环境变量名 ${name} 不合法，应为大写字母、数字与下划线`)
    }

    if (typeof value !== 'string' || value.length > MAX_TEXT) {
      return fail(`环境变量 ${name} 的值必须是字符串`)
    }

    env[name] = value
  }

  return { ok: true, value: env }
}

function parseCredentialBinding(input: unknown): Parsed<AgentCredentialBinding | undefined> {
  if (input === undefined || input === null) {
    return { ok: true, value: undefined }
  }

  const raw = asRecord(input)

  if (!raw) {
    return fail('凭据绑定必须是对象')
  }

  const providerId = asText(raw.providerId, 32)

  if (providerId === undefined || !ID_PATTERN.test(providerId)) {
    return fail('凭据绑定里的提供方标识不合法')
  }

  const apiKeyEnv = asEnvName(raw.apiKeyEnv)
  const baseUrlEnv = asEnvName(raw.baseUrlEnv)

  if (apiKeyEnv === undefined || baseUrlEnv === undefined) {
    return fail('凭据绑定需要合法的密钥与 base URL 环境变量名')
  }

  if (raw.modelEnv === undefined || raw.modelEnv === null) {
    return { ok: true, value: { providerId, apiKeyEnv, baseUrlEnv, modelEnv: undefined } }
  }

  const modelEnv = asEnvName(raw.modelEnv)

  if (modelEnv === undefined) {
    return fail('凭据绑定里的模型环境变量名不合法')
  }

  return { ok: true, value: { providerId, apiKeyEnv, baseUrlEnv, modelEnv } }
}

function parseDefaultConfigOptions(input: unknown): Parsed<Record<string, AgentConfigOptionValue>> {
  if (input === undefined) {
    return { ok: true, value: {} }
  }

  const raw = asRecord(input)

  if (!raw) {
    return fail('默认会话配置必须是对象')
  }

  const options: Record<string, AgentConfigOptionValue> = {}

  for (const [configId, value] of Object.entries(raw)) {
    if (asText(configId, 64) === undefined) {
      return fail('会话配置项 id 必须是非空字符串')
    }

    if (typeof value !== 'string' && typeof value !== 'boolean') {
      return fail('会话配置值只能是字符串或布尔值')
    }

    options[configId] = value
  }

  return { ok: true, value: options }
}

/**
 * 校验一个来源不可信的 agent 档案。
 *
 * agents.json 可以被手改，界面也能填任意文本，两者都不可信：一个被改坏的档案
 * 不应该变成一次任意命令执行。所以校验集中在这里，而不是散落到调用点。
 */
export function parseAcpAgentProfile(input: unknown): AcpAgentProfileParse {
  const raw = asRecord(input)

  if (!raw) {
    return fail('agent 档案必须是对象')
  }

  const identity = parseIdentity(raw)

  if (!identity.ok) {
    return identity
  }

  const command = parseCommand(raw.command)

  if (!command.ok) {
    return command
  }

  const args = parseArgs(raw.args)

  if (!args.ok) {
    return args
  }

  const cwd = parseCwd(raw.cwd)

  if (!cwd.ok) {
    return cwd
  }

  const env = parseEnv(raw.env)

  if (!env.ok) {
    return env
  }

  const binding = parseCredentialBinding(raw.credentialBinding)

  if (!binding.ok) {
    return binding
  }

  const defaults = parseDefaultConfigOptions(raw.defaultConfigOptions)

  if (!defaults.ok) {
    return defaults
  }

  return {
    ok: true,
    profile: {
      id: identity.value.id,
      displayName: identity.value.displayName,
      command: command.value,
      args: args.value,
      cwd: cwd.value,
      env: env.value,
      credentialBinding: binding.value,
      defaultConfigOptions: defaults.value,
    },
  }
}

/**
 * 解析整份配置。
 *
 * 单个坏档案只会被丢弃并记一条 issue，不会让整份 agents.json 解析失败——
 * 否则用户手滑一个字符就会丢掉全部 agent。这是 Zed 设置层的处理方式。
 */
export function parseAcpAgentProfileSet(input: unknown): AcpAgentProfileSetParse {
  const raw = asRecord(input)

  if (!raw || !Array.isArray(raw.profiles)) {
    return {
      value: builtinAcpAgentProfileSet(),
      issues: ['agent 配置无法解析，已回退到内置档案'],
    }
  }

  const issues: string[] = []
  const profiles: AcpAgentProfile[] = []

  for (const candidate of raw.profiles.slice(0, MAX_PROFILES)) {
    const parsed = parseAcpAgentProfile(candidate)

    if (!parsed.ok) {
      issues.push(parsed.issue)
      continue
    }

    if (profiles.some((existing) => existing.id === parsed.profile.id)) {
      issues.push(`agent 标识重复，已忽略后一个：${parsed.profile.id}`)
      continue
    }

    profiles.push(parsed.profile)
  }

  const first = profiles[0]

  if (!first) {
    return {
      value: builtinAcpAgentProfileSet(),
      issues: [...issues, '没有可用的 agent 档案，已回退到内置档案'],
    }
  }

  const requested = asText(raw.defaultProfileId, 32)
  const matched = requested !== undefined && profiles.some((one) => one.id === requested)
  const defaultProfileId = matched && requested !== undefined ? requested : first.id

  if (requested !== undefined && !matched) {
    issues.push(`默认 agent 指向了不存在的档案，已改用 ${defaultProfileId}`)
  }

  return { value: { profiles, defaultProfileId }, issues }
}

/** 供界面显示与复制的一行命令。执行时仍然走 command + args。 */
export function acpAgentCommandLine(profile: AcpAgentProfile): string {
  return [profile.command, ...profile.args].join(' ')
}

/**
 * 从命令行文本还原 command + args。
 *
 * 只按空白切分，不处理引号与转义：在这里实现半个 shell 解析器，只会得到一个
 * 说不清行为的输入框。路径带空格的情况请直接改 args。
 */
export function parseAcpAgentCommandLine(input: string): {
  readonly command: string
  readonly args: string[]
} {
  const parts = input
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)

  return { command: parts[0] ?? '', args: parts.slice(1) }
}

/** 为某个方言生成一份默认的凭据绑定。 */
export function defaultCredentialBinding(
  providerId: string,
  dialect: ModelProviderDialect,
): AgentCredentialBinding {
  const names = defaultEnvNames(dialect)

  return {
    providerId,
    apiKeyEnv: names.apiKey,
    baseUrlEnv: names.baseUrl,
    modelEnv: names.model,
  }
}

/**
 * 内置 agent 档案，从既有的 acpAgents() 派生。
 *
 * acp-agents.ts 仍然是 agent 名单的唯一来源；这里只是把 "kimi acp" 这种
 * 命令行字符串拆成可以直接 spawn 的 command + args。
 */
export function builtinAcpAgentProfiles(): readonly AcpAgentProfile[] {
  return acpAgents().map((agent) => {
    const { command, args } = parseAcpAgentCommandLine(agent.command)

    return {
      id: agent.id,
      displayName: agent.displayName,
      command,
      args,
      cwd: undefined,
      env: {},
      credentialBinding: undefined,
      defaultConfigOptions: {},
    }
  })
}

export function builtinAcpAgentProfileSet(): AcpAgentProfileSet {
  return { profiles: builtinAcpAgentProfiles(), defaultProfileId: defaultAcpAgent().id }
}
