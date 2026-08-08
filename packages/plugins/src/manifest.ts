import * as v from 'valibot'

/*
 * 插件清单的形状由 Kimi Code 拥有，不由我们定义：<plugin_root>/kimi.plugin.json，
 * 缺席时回落到 <plugin_root>/.kimi-plugin/plugin.json。两个都在时前者胜出，所以
 * 这张表是有序的：读取方按序取第一个命中的文件。
 */
export const PLUGIN_MANIFEST_FILENAMES = ['kimi.plugin.json', '.kimi-plugin/plugin.json'] as const

/*
 * 提示词预算：单个插件 32 KiB，一次会话内全部启用插件合计 64 KiB。
 *
 * 单位是 UTF-8 字节，不是 String.length 的 UTF-16 码元数 —— '插件'.length 是 2，
 * 字节数是 6。按码元算会让预算在中文场景下形同虚设。
 */
export const PLUGIN_PROMPT_BUDGET_BYTES = 32 * 1024

export const SESSION_PROMPT_BUDGET_BYTES = 64 * 1024

/*
 * 上游运行时已经不认这几个字段。读到只记一条诊断、不生效 —— 静默忽略会把
 * 「装上了却没反应」变成一个查不出原因的问题。
 */
export const UNSUPPORTED_MANIFEST_FIELDS = ['apps', 'configFile', 'inject', 'tools'] as const

export const COMMAND_DESCRIPTION_LIMIT = 240

export const MISSING_COMMAND_DESCRIPTION = 'No description provided.'

/* 插件名同时是命令命名空间与磁盘目录名，所以约束由上游定死。 */
const PLUGIN_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/

const encoder = new TextEncoder()

export type PluginDiagnosticCode =
  | 'agent-needs-override'
  | 'command-name-taken'
  | 'manifest-invalid'
  | 'name-invalid'
  | 'prompt-ambiguous'
  | 'prompt-budget-exhausted'
  | 'prompt-too-large'
  | 'unsupported-field'

export interface PluginDiagnostic {
  readonly code: PluginDiagnosticCode
  readonly pluginId: string
  readonly detail: string
}

/*
 * 提示词是一条判别联合，不是两个可选字段。
 *
 * 上游清单里 systemPrompt 与 systemPromptPath 是两个键，描述的却是同一段东西：
 * 两个键就是两个来源，「两个都写了听谁的」这种不变量要靠人记住。这里让它连写
 * 都写不出来，两个都给就是一条诊断。
 */
export interface AbsentPrompt {
  readonly kind: 'absent'
}

export interface InlinePrompt {
  readonly kind: 'inline'
  readonly text: string
}

export interface FilePrompt {
  readonly kind: 'file'
  readonly path: string
}

export type PluginSystemPrompt = AbsentPrompt | FilePrompt | InlinePrompt

export interface PluginAgentDeclaration {
  readonly name: string
  readonly override: boolean
}

export interface PluginCommandDeclaration {
  readonly name: string
  readonly description: string
  readonly body: string
}

export interface PluginMcpServerDeclaration {
  readonly name: string
  /* 服务器配置原样透传：它的形状归 MCP 规范所有，插件域不重新定义一遍。 */
  readonly config: Readonly<Record<string, unknown>>
}

/*
 * 归一之后的清单：没有可选属性。
 *
 * 「写没写」在解析期就判完了 —— 数组是空数组，提示词是 absent，可缺的字符串
 * 显式是 undefined。下游因此不需要在每个读取点再判一次。
 */
export interface PluginManifest {
  readonly name: string
  readonly displayName: string
  readonly description: string | undefined
  readonly version: string | undefined
  readonly developerName: string | undefined
  readonly homepage: string | undefined
  readonly skills: readonly string[]
  readonly agents: readonly PluginAgentDeclaration[]
  readonly commands: readonly PluginCommandDeclaration[]
  readonly mcpServers: readonly PluginMcpServerDeclaration[]
  readonly systemPrompt: PluginSystemPrompt
}

export interface AcceptedManifest {
  readonly kind: 'accepted'
  readonly manifest: PluginManifest
  readonly diagnostics: readonly PluginDiagnostic[]
}

export interface RejectedManifest {
  readonly kind: 'rejected'
  readonly diagnostics: readonly PluginDiagnostic[]
}

/*
 * 解析失败是预期结果，不是异常：磁盘上放着一份写坏的清单是日常，界面要把它
 * 显示成一行「这个插件为什么没生效」。所以失败是返回值，不是 throw。
 */
export type ManifestDecoding = AcceptedManifest | RejectedManifest

const InterfaceBlock = v.looseObject({
  displayName: v.optional(v.string()),
  developerName: v.optional(v.string()),
  websiteURL: v.optional(v.string()),
})

/*
 * skills 可以是一条目录路径，也可以是一串路径。
 *
 * 证据是上游官方插件本身：kimi-webbridge 的 kimi.plugin.json 写的是
 * "skills": "./skills/"。只认数组会让这份真清单整份被判无效 —— 表现成「装得下来、
 * 却说清单不合法」，而错的是我们收窄过头，不是它写错了。
 */
const SkillsEntry = v.union([v.string(), v.array(v.string())])

/* 宽进严出：进来的形状由上游决定，出去的形状由我们决定。 */
const AgentEntry = v.union([
  v.string(),
  v.looseObject({ name: v.string(), override: v.optional(v.boolean()) }),
])

const CommandEntry = v.looseObject({
  name: v.string(),
  description: v.optional(v.string()),
  body: v.optional(v.string()),
})

const RawManifest = v.looseObject({
  name: v.string(),
  version: v.optional(v.string()),
  description: v.optional(v.string()),
  homepage: v.optional(v.string()),
  interface: v.optional(InterfaceBlock),
  skills: v.optional(SkillsEntry),
  agents: v.optional(v.array(AgentEntry)),
  commands: v.optional(v.array(CommandEntry)),
  mcpServers: v.optional(v.record(v.string(), v.record(v.string(), v.unknown()))),
  systemPrompt: v.optional(v.string()),
  systemPromptPath: v.optional(v.string()),
})

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).length
}

/*
 * 命令说明的回落顺序取自上游：声明的 description、正文第一条非空行（截到 240
 * 字）、再没有就是那句固定文案。
 */
export function commandDescription(declared: string | undefined, body: string): string {
  if (declared !== undefined && declared.trim() !== '') {
    return declared.trim()
  }

  const firstLine = body.split('\n').find((line) => line.trim() !== '')

  if (firstLine === undefined) {
    return MISSING_COMMAND_DESCRIPTION
  }

  return firstLine.trim().slice(0, COMMAND_DESCRIPTION_LIMIT)
}

/* 一条路径与一串路径在下游没有区别，差异在解码期就抹掉。 */
function normalizeSkills(declared: string | string[] | undefined): readonly string[] {
  if (declared === undefined) {
    return []
  }

  return typeof declared === 'string' ? [declared] : declared
}

interface PromptResolution {
  readonly prompt: PluginSystemPrompt
  readonly diagnostics: readonly PluginDiagnostic[]
}

function resolvePrompt(
  name: string,
  inline: string | undefined,
  file: string | undefined,
): PromptResolution {
  if (inline !== undefined && file !== undefined) {
    return {
      prompt: { kind: 'absent' },
      diagnostics: [
        {
          code: 'prompt-ambiguous',
          pluginId: name,
          detail: 'systemPrompt 与 systemPromptPath 同时存在，同一段提示词不能有两个来源',
        },
      ],
    }
  }

  if (inline !== undefined) {
    const bytes = utf8ByteLength(inline)

    if (bytes > PLUGIN_PROMPT_BUDGET_BYTES) {
      return {
        prompt: { kind: 'absent' },
        diagnostics: [
          {
            code: 'prompt-too-large',
            pluginId: name,
            detail: `${bytes} 字节，超过单个插件 ${PLUGIN_PROMPT_BUDGET_BYTES} 字节的上限`,
          },
        ],
      }
    }

    return { prompt: { kind: 'inline', text: inline }, diagnostics: [] }
  }

  if (file !== undefined) {
    return { prompt: { kind: 'file', path: file }, diagnostics: [] }
  }

  return { prompt: { kind: 'absent' }, diagnostics: [] }
}

function unsupportedFieldDiagnostics(name: string, input: unknown): readonly PluginDiagnostic[] {
  if (typeof input !== 'object' || input === null) {
    return []
  }

  return UNSUPPORTED_MANIFEST_FIELDS.filter((field) => Object.hasOwn(input, field)).map(
    (field) => ({
      code: 'unsupported-field' as const,
      pluginId: name,
      detail: `${field} 已不被运行时支持，本次加载忽略了它`,
    }),
  )
}

export function decodePluginManifest(input: unknown): ManifestDecoding {
  const parsed = v.safeParse(RawManifest, input)

  if (!parsed.success) {
    return {
      kind: 'rejected',
      diagnostics: [
        {
          code: 'manifest-invalid',
          pluginId: '',
          detail: parsed.issues.map((issue) => issue.message).join('; '),
        },
      ],
    }
  }

  const raw = parsed.output

  if (!PLUGIN_NAME.test(raw.name)) {
    return {
      kind: 'rejected',
      diagnostics: [
        {
          code: 'name-invalid',
          pluginId: raw.name,
          detail: `"${raw.name}" 不匹配 ${PLUGIN_NAME.source}`,
        },
      ],
    }
  }

  const prompt = resolvePrompt(raw.name, raw.systemPrompt, raw.systemPromptPath)
  const declaredServers: Readonly<Record<string, Record<string, unknown>>> = raw.mcpServers ?? {}

  return {
    kind: 'accepted',
    diagnostics: [...unsupportedFieldDiagnostics(raw.name, input), ...prompt.diagnostics],
    manifest: {
      name: raw.name,
      displayName: raw.interface?.displayName ?? raw.name,
      description: raw.description,
      version: raw.version,
      developerName: raw.interface?.developerName,
      homepage: raw.homepage,
      skills: normalizeSkills(raw.skills),
      agents: (raw.agents ?? []).map((entry) =>
        typeof entry === 'string'
          ? { name: entry, override: false }
          : { name: entry.name, override: entry.override ?? false },
      ),
      commands: (raw.commands ?? []).map((entry) => ({
        name: entry.name,
        description: commandDescription(entry.description, entry.body ?? ''),
        body: entry.body ?? '',
      })),
      mcpServers: Object.entries(declaredServers).map(([name, config]) => ({ name, config })),
      systemPrompt: prompt.prompt,
    },
  }
}
