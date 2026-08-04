import * as v from 'valibot'
import type { AcpAgentDescriptor } from './acp-agent-contract'
import { acpAgents } from './acp-agents'

/** 会话配置值。对应 ACP 的 ConfigOption currentValue（string | boolean）。 */
export type AgentConfigOptionValue = string | boolean

/**
 * 一个 ACP agent 的接入档案：这台机器上，用户为这一家 agent 做的选择。
 *
 * 只有四格，而且每一格都真的属于用户。此前还有七格 —— displayName、command、
 * args、homeVar、registryKeyVar、ownHomeDirectory、install —— 它们描述的是「这
 * 一家 agent 是什么」，那件事由二进制里的 AcpAgentDescriptor 说了算：名单是封闭
 * 的（见 acp-agents.ts），界面上没有、也不会有一个能自带命令的入口。
 *
 * 那七格不是没用，是从来没被用过一次：reconcileAcpAgentProfiles 每次读都拿内置
 * 值把它们逐一覆盖回去。写进磁盘只为了下一次读出来时被扔掉，中间那段路上却要
 * 一整套针对不可信输入的校验陪着走 —— 反 shell 注入、npm 包名、目录名不许带分
 * 隔符。防的是一个不存在的输入源。
 *
 * 现在 command 在磁盘上没有产地，所以「一份被改坏的档案变成一次任意命令执行」
 * 这条路不是被正则拦住的，是结构上不存在。
 *
 * 这里刻意没有\"收藏了哪些模型\"：那份状态只存在提供方档案里一处。也没有\"支持哪些
 * 模型\"，因为那是会话在 session/new 之后才报告的事。
 */
export interface AcpAgentProfile {
  /** 名单里的哪一家。不在名单里的档案会在物化时被移除。 */
  readonly id: string
  readonly cwd?: string | undefined
  /**
   * 非敏感环境变量，会原样落盘。
   *
   * 密钥永远不在这里，也不在别处：它由界面随 AgentConfigStore.execCli 的一次
   * 调用交给 agent 官方 CLI，写进 agent 自己的配置文件之后就与我们无关。我们
   * 不注入密钥环境变量，也不拼对方的配置文件格式。
   *
   * 受控 home 那个变量名不在这里 —— 它归二进制（AcpAgentDescriptor.homeVar），
   * 值由原生侧的 launch_env 现算。
   */
  readonly env: Readonly<Record<string, string>>
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
  /**
   * value 不是从输入里解析出来的，是内置档案顶上去的。
   *
   * 没有这一格的时候，value 同时承担两种含义 ——「磁盘上写着这些」和「磁盘没说，
   * 我替你编了这些」—— 而调用方分不出来。下游因此拿一个自己编的值去跟内置档案
   * 比对、问「变了吗」，答案恒为「没变」，于是首次启动的物化一次都没发生过：
   * 渲染层用着内存里的内置档案，原生层读磁盘只读到空文件，两半各说各话。
   *
   * 为真表示磁盘上那份还不作数，调用方应当把 value 物化下去。
   */
  readonly fallback: boolean
}

const ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/

const MAX_TEXT = 512
const MAX_ENTRIES = 32
const MAX_PROFILES = 32

/*
 * 档案的形状就是下面这张表。
 *
 * 此前这里是一个手写的校验框架：一个 Parsed<T> 结果类型、一个 fail、两个
 * asRecord/asText 探针、七个 parseXxx 函数，最后由九段 if (!x.ok) return x 串
 * 起来 —— 240 行把\"每个字段长什么样\"这件声明式的事，写成了命令式的流程控制。
 *
 * 代价不是观感：接口手写一遍、校验再手写一遍，两份靠人对齐，给档案加一个字段
 * 而忘了补校验时编译器一声不吭，它只是静默地不再校验那一格。
 *
 * valibot 1.4.2 本来就在 pnpm-workspace.yaml 的 catalog 里。校验来源不可信的
 * 输入正是标准能力该上场的地方：模式即文档，类型由模式推出。
 *
 * 表比从前短，不是因为放松了，是因为不该由用户拥有的字段已经不在磁盘上了。
 * 留下的两格 cwd 与 env 仍然完全来自用户，它们的规则一个字都没有动。
 *
 * 每条规则都自带中文说法，因为这些话会出现在设置界面上。
 */
const text = (max: number, message: string) =>
  v.pipe(v.string(message), v.minLength(1, message), v.maxLength(max, message))

const envName = (message: string) => v.pipe(text(64, message), v.regex(ENV_NAME_PATTERN, message))

const ID_ISSUE = 'agent 标识只允许小写字母、数字与连字符，且以字母开头'
const PROFILE_ISSUE = 'agent 档案无法解析'

const ProfileSchema = v.object({
  id: v.pipe(text(32, ID_ISSUE), v.regex(ID_PATTERN, ID_ISSUE)),
  cwd: v.nullish(text(1024, '工作目录必须是非空字符串')),
  env: v.optional(
    v.pipe(
      v.record(
        envName('环境变量名不合法，应为大写字母、数字与下划线'),
        text(MAX_TEXT, '环境变量的值必须是字符串'),
        '环境变量必须是对象',
      ),
      v.check((env) => Object.keys(env).length <= MAX_ENTRIES, `环境变量不超过 ${MAX_ENTRIES} 项`),
    ),
    {},
  ),
  defaultConfigOptions: v.optional(
    v.record(
      text(64, '会话配置项 id 必须是非空字符串'),
      v.union([v.string(), v.boolean()], '会话配置值只能是字符串或布尔值'),
      '默认会话配置必须是对象',
    ),
    {},
  ),
})

/*
 * 整份配置的信封。
 *
 * defaultProfileId 用 fallback 而不是让它报错：那一格填坏了只算没填，回落到
 * 第一个档案。一个错字不该让整份 agents.json 作废。
 */
const EnvelopeSchema = v.object({
  profiles: v.array(v.unknown()),
  defaultProfileId: v.fallback(
    v.nullish(v.pipe(v.string(), v.minLength(1), v.maxLength(32))),
    undefined,
  ),
})

/*
 * 缺席与 null 在磁盘上都表示\"没有这一项\"，在类型里只留 undefined 一种：
 * 让两种空值一路往下走，就是让每个下游都判两次。
 */
function shape(parsed: v.InferOutput<typeof ProfileSchema>): AcpAgentProfile {
  return {
    id: parsed.id,
    cwd: parsed.cwd ?? undefined,
    env: parsed.env,
    defaultConfigOptions: parsed.defaultConfigOptions,
  }
}

/**
 * 校验一个来源不可信的 agent 档案。
 *
 * agents.json 可以被手改，所以它不可信 —— 但界面填不出档案：agent 名单是封闭的，
 * 用户在注册过的几家里选，选择本身只是一个 id。校验因此只面对磁盘这一个来源。
 */
export function parseAcpAgentProfile(input: unknown): AcpAgentProfileParse {
  const parsed = v.safeParse(ProfileSchema, input, { abortPipeEarly: true })

  if (!parsed.success) {
    return { ok: false, issue: parsed.issues[0]?.message ?? PROFILE_ISSUE }
  }

  return { ok: true, profile: shape(parsed.output) }
}

/**
 * 解析整份配置。
 *
 * 单个坏档案只会被丢弃并记一条 issue，不会让整份 agents.json 解析失败——
 * 否则用户手滑一个字符就会丢掉全部 agent。这是 Zed 设置层的处理方式。
 */
export function parseAcpAgentProfileSet(input: unknown): AcpAgentProfileSetParse {
  const envelope = v.safeParse(EnvelopeSchema, input)

  if (!envelope.success) {
    return {
      value: builtinAcpAgentProfileSet(),
      issues: ['agent 配置无法解析，已回退到内置档案'],
      fallback: true,
    }
  }

  const issues: string[] = []
  const profiles: AcpAgentProfile[] = []

  for (const candidate of envelope.output.profiles.slice(0, MAX_PROFILES)) {
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
    /*
     * 「磁盘上一条都没有」和「有，但全都用不了」是两件事，此前共用一句话。
     *
     * 前者是每一台新电脑的第一次启动 —— 不是配置出了问题，是还没开始。把它报成
     * issue，设置页第一屏就会挂一句「没有可用的 agent 档案」，而用户什么都没做错。
     * 后者是真的坏了，必须说出来，而且措辞要说清坏的是磁盘上那份。
     *
     * 两条路都要 fallback: true —— 内置档案得落到磁盘上，原生侧才查得到它。
     */
    const nothingOnDisk = envelope.output.profiles.length === 0

    return {
      value: builtinAcpAgentProfileSet(),
      issues: nothingOnDisk
        ? issues
        : [...issues, '配置里的 agent 档案都无法使用，已回退到内置档案'],
      fallback: true,
    }
  }

  const requested = envelope.output.defaultProfileId ?? undefined
  const matched = requested !== undefined && profiles.some((one) => one.id === requested)
  const defaultProfileId = matched && requested !== undefined ? requested : first.id

  if (requested !== undefined && !matched) {
    issues.push(`默认 agent 指向了不存在的档案，已改用 ${defaultProfileId}`)
  }

  return { value: { profiles, defaultProfileId }, issues, fallback: false }
}

/** 起一个 agent 进程要说清的三件事。 */
export interface AcpAgentLaunch {
  readonly agentId: string
  readonly program: string
  readonly args: readonly string[]
}

/**
 * 把一家 agent 翻成一次启动。
 *
 * 收的是内置描述符本身。此前这里收一个 AcpAgentLaunchSource { id, command, args }，
 * 理由写着「内置描述符与用户档案都能直接传进来」—— 而用户档案里从来就没有过
 * command，全仓两个调用点送进来的也都是描述符。那是给一个不存在的调用者留的门。
 *
 * 名字与参数始终分开，从这里一路到 spawn 都不合并成字符串。合并是有损的：对面
 * 若按 POSIX 词法切回来，绝对路径 C:\\tools\\kimi.exe 的反斜杠会被当成转义符
 * 吃掉，带空格的路径会被切断。
 *
 * 业界标杆同样不合并：Zed 的 AgentServerCommand 是 path/args/env 三元组，连跨
 * 进程的 protobuf（crates/proto/proto/ai.proto）都保持结构化，整个仓库一处都
 * 没有用 shell_words。
 */
export function acpAgentLaunch(agent: AcpAgentDescriptor): AcpAgentLaunch {
  return { agentId: agent.id, program: agent.command, args: [...agent.args] }
}

/**
 * 内置 agent 的档案：一家一条，用户那几格都还是空的。
 *
 * 它不再从描述符里抄七个字段过来 —— 那些字段现在只有一个产地。
 */
export function builtinAcpAgentProfiles(): readonly [AcpAgentProfile, ...AcpAgentProfile[]] {
  const blank = (agent: AcpAgentDescriptor): AcpAgentProfile => ({
    id: agent.id,
    cwd: undefined,
    env: {},
    defaultConfigOptions: {},
  })
  const [first, ...rest] = acpAgents()

  return [blank(first), ...rest.map(blank)]
}

/*
 * 内置档案集。默认 id 由这一份档案自己的第一条推出 —— 此前它再去查一次名单，
 * 于是「默认哪一家」同时被名单顺序和档案集定义，两个产地。
 */
export function builtinAcpAgentProfileSet(): AcpAgentProfileSet {
  const profiles = builtinAcpAgentProfiles()

  return { profiles, defaultProfileId: profiles[0].id }
}

/** 一次物化的结果。changed 为真表示磁盘上那份与名单不一致。 */
export interface AcpAgentProfileReconcile {
  readonly profiles: readonly AcpAgentProfile[]
  readonly changed: boolean
  /** 为了对齐名单而丢掉了什么。界面要说出来，不能默默改用户的文件。 */
  readonly issues: readonly string[]
}

/**
 * 把落盘的档案与二进制里的名单对齐。
 *
 * 此前这里要逐格比对七个字段（sameLaunchIdentity 与 sameInstall 两个函数），
 * 因为那七格既在磁盘上、又在二进制里，两份得对齐。现在它们只在二进制里，所以
 * 这里没有任何字段要比 —— 只剩名单本身要对齐。
 *
 * 陌生 id 现在移除，而不是原样保留。保留是上一版为「用户自带的 agent」留的余地，
 * 而那条路不存在：acp-agents.ts 说得很清楚，名单是封闭的。留着它，设置页的下拉
 * 就会列出一家原生侧根本查不到程序的 agent，选中之后失败在一个与选择无关的地方。
 * 丢掉一行用户手写的配置必须说出来，所以它带一条 issue 出去。
 *
 * 名单里有、磁盘上没有的补上：接第二家 agent 时它得自己出现，而不是只对新用户出现。
 */
export function reconcileAcpAgentProfiles(
  profiles: readonly AcpAgentProfile[],
): AcpAgentProfileReconcile {
  const known = new Set(acpAgents().map((agent) => agent.id))
  const issues: string[] = []

  const kept = profiles.filter((profile) => {
    if (known.has(profile.id)) {
      return true
    }

    issues.push(`配置里的 ${profile.id} 不是本软件支持的 agent，已从 agents.json 移除`)

    return false
  })

  const missing = builtinAcpAgentProfiles().filter(
    (builtin) => !kept.some((one) => one.id === builtin.id),
  )

  return {
    profiles: [...kept, ...missing],
    changed: issues.length > 0 || missing.length > 0,
    issues,
  }
}
