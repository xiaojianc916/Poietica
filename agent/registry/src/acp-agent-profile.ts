import * as v from 'valibot'
import type { AcpAgentInstall } from './acp-agent-contract'
import { acpAgents, defaultAcpAgent } from './acp-agents'

/** 会话配置值。对应 ACP 的 ConfigOption currentValue（string | boolean）。 */
export type AgentConfigOptionValue = string | boolean

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
  /**
   * 非敏感环境变量，会原样落盘，例如数据根目录 KIMI_CODE_HOME。
   *
   * 密钥永远不在这里，也不在别处：它由界面随 AgentConfigStore.execCli 的一次
   * 调用交给 agent 官方 CLI，写进 agent 自己的配置文件之后就与我们无关。我们
   * 不注入密钥环境变量，也不拼对方的配置文件格式。
   */
  readonly env: Readonly<Record<string, string>>
  /**
   * 受控 home 的环境变量名，例如 Kimi Code 的 KIMI_CODE_HOME。
   *
   * 只记名字，不记路径：原生侧的 launch_env 会用 paths::agent_home 现算出
   * 一个已经创建好的目录，把它设到这个变量上。
   *
   * 缺席表示这个 agent 不接受受控 home。
   */
  readonly homeVar?: string | undefined
  /**
   * 代填密钥时注入哪个环境变量名。只记名字，值一次都不落盘。
   *
   * 缺席表示这一家不接受由我们代填密钥。
   */
  readonly registryKeyVar?: string | undefined
  /**
   * 不受控时，这家 agent 在用户 home 之下的数据目录名，例如 Kimi Code 的 .kimi-code。
   *
   * 只记名字：用户 home 由原生侧现算。缺席表示我们说不出它把配置放在哪。
   */
  readonly ownHomeDirectory?: string | undefined
  /**
   * 这个 agent 的运行时怎么装。身份归二进制，与 command / registryKeyVar 同一条规则。
   *
   * 缺席表示不由我们管安装 —— 用户自带的 agent 就是这一类。
   */
  readonly install?: AcpAgentInstall | undefined
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
/* 一个纯粹的目录名：允许开头一个点（.kimi-code），但第二个字符必须是字母数字，
 * 于是 .. 与任何带分隔符的路径都进不来 —— 这一格会被接在用户 home 后面去读文件。 */
const HOME_DIRECTORY_PATTERN = /^\.?[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SHELL_METACHARACTERS = /[;&|<>$`\n\r"']/
/* npm 的合法包名。这一格会被交给 npm install，所以它和 command 一样不可信。 */
const NPM_PACKAGE_PATTERN = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

const MAX_ARGS = 32
const MAX_TEXT = 512
const MAX_ENTRIES = 32
const MAX_PROFILES = 32

/*
 * 档案的形状就是下面这张表。
 *
 * 此前这里是一个手写的校验框架：一个 Parsed<T> 结果类型、一个 fail、两个
 * asRecord/asText 探针、七个 parseXxx 函数，最后由九段 if (!x.ok) return x 串
 * 起来 —— 240 行把"每个字段长什么样"这件声明式的事，写成了命令式的流程控制。
 *
 * 代价不是观感：接口手写一遍、校验再手写一遍，两份靠人对齐，给档案加一个字段
 * 而忘了补校验时编译器一声不吭，它只是静默地不再校验那一格。parseEnvVarName
 * 上面那句注释已经承认了这件事 ——"写两遍就会有一天只改了一遍"。
 *
 * valibot 1.4.2 本来就在 pnpm-workspace.yaml 的 catalog 里，只是这个包没用它。
 * 校验来源不可信的输入正是标准能力该上场的地方：模式即文档，类型由模式推出，
 * 漏一格不再是"忘了写一段 if"，而是编译不过。
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
  displayName: text(64, 'agent 需要一个 1–64 字的名称'),
  command: v.pipe(
    text(256, '启动命令不能为空'),
    v.check(
      (command) => !SHELL_METACHARACTERS.test(command),
      '启动命令不经 shell 执行，不能包含 ; & | < > $ 等字符',
    ),
  ),
  args: v.optional(
    v.pipe(
      v.array(text(MAX_TEXT, '参数必须是非空字符串'), '参数必须是数组'),
      v.maxLength(MAX_ARGS, `参数不超过 ${MAX_ARGS} 项`),
    ),
    [],
  ),
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
  /* 受控 home 与代填密钥只记名字不记值，规则逐字相同，所以是同一个 envName。 */
  homeVar: v.nullish(envName('受控 home 的变量名不合法，应为大写字母、数字与下划线')),
  registryKeyVar: v.nullish(envName('注册表密钥的变量名不合法，应为大写字母、数字与下划线')),
  ownHomeDirectory: v.nullish(
    v.pipe(
      text(64, '自有 home 的目录名必须是非空字符串'),
      v.regex(HOME_DIRECTORY_PATTERN, '自有 home 只能是一个目录名，不能是路径'),
    ),
  ),
  install: v.nullish(
    v.object({
      packageName: v.pipe(
        text(214, 'npm 包名必须是非空字符串'),
        v.regex(NPM_PACKAGE_PATTERN, 'npm 包名不合法'),
      ),
      versionArgs: v.optional(
        v.pipe(
          v.array(text(MAX_TEXT, '参数必须是非空字符串'), '参数必须是数组'),
          v.maxLength(MAX_ARGS, `参数不超过 ${MAX_ARGS} 项`),
        ),
        ['--version'],
      ),
    }),
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
 * 第一个档案 —— 与此前 asText 返回 undefined 时的行为一致。一个错字不该让整份
 * agents.json 作废。
 */
const EnvelopeSchema = v.object({
  profiles: v.array(v.unknown()),
  defaultProfileId: v.fallback(
    v.nullish(v.pipe(v.string(), v.minLength(1), v.maxLength(32))),
    undefined,
  ),
})

/*
 * 缺席与 null 在磁盘上都表示"没有这一项"，在类型里只留 undefined 一种：
 * 让两种空值一路往下走，就是让每个下游都判两次。
 */
function shape(parsed: v.InferOutput<typeof ProfileSchema>): AcpAgentProfile {
  return {
    id: parsed.id,
    displayName: parsed.displayName,
    command: parsed.command,
    args: parsed.args,
    cwd: parsed.cwd ?? undefined,
    env: parsed.env,
    homeVar: parsed.homeVar ?? undefined,
    registryKeyVar: parsed.registryKeyVar ?? undefined,
    ownHomeDirectory: parsed.ownHomeDirectory ?? undefined,
    install: parsed.install ?? undefined,
    defaultConfigOptions: parsed.defaultConfigOptions,
  }
}

/**
 * 校验一个来源不可信的 agent 档案。
 *
 * agents.json 可以被手改，界面也能填任意文本，两者都不可信：一个被改坏的档案
 * 不应该变成一次任意命令执行。所以校验集中在这里，而不是散落到调用点。
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

/** 说得出一次启动的东西：内置描述符有这三格，用户档案也有这三格。 */
export interface AcpAgentLaunchSource {
  readonly id: string
  readonly command: string
  readonly args: readonly string[]
}

/** 起一个 agent 进程要说清的三件事。 */
export interface AcpAgentLaunch {
  readonly agentId: string
  readonly program: string
  readonly args: readonly string[]
}

/**
 * 把一份档案翻成一次启动。
 *
 * 名字与参数始终分开，从这里一路到 spawn 都不合并成字符串。合并是有损的：对面
 * 若按 POSIX 词法切回来，绝对路径 C:\\tools\\kimi.exe 的反斜杠会被当成转义符
 * 吃掉，带空格的路径会被切断 —— 而 parseCommand 是允许绝对路径的。
 *
 * 业界标杆同样不合并：Zed 的 AgentServerCommand 是 path/args/env 三元组，连跨
 * 进程的 protobuf（crates/proto/proto/ai.proto）都保持结构化，整个仓库一处都
 * 没有用 shell_words。
 *
 * 三格就够，因此不强求一整份 AcpAgentProfile：内置描述符与用户档案都能直接传
 * 进来，不必先补出一堆用不上的字段。
 */
export function acpAgentLaunch(agent: AcpAgentLaunchSource): AcpAgentLaunch {
  return { agentId: agent.id, program: agent.command, args: [...agent.args] }
}

/**
 * 内置 agent 档案，从既有的 acpAgents() 派生。
 *
 * acp-agents.ts 仍然是 agent 名单的唯一来源，而它记的已经是可以直接 spawn
 * 的 command + args，所以这里没有任何一行命令要拼、也没有一次解析要做。
 */
export function builtinAcpAgentProfiles(): readonly AcpAgentProfile[] {
  return acpAgents().map((agent) => {
    return {
      id: agent.id,
      displayName: agent.displayName,
      command: agent.command,
      args: [...agent.args],
      cwd: undefined,
      env: {},
      homeVar: agent.homeVar,
      registryKeyVar: agent.registryKeyVar,
      ownHomeDirectory: agent.ownHomeDirectory,
      install: agent.install,
      defaultConfigOptions: {},
    }
  })
}

export function builtinAcpAgentProfileSet(): AcpAgentProfileSet {
  return { profiles: builtinAcpAgentProfiles(), defaultProfileId: defaultAcpAgent().id }
}

/** 一次物化的结果。changed 为真表示磁盘上那份与二进制不一致。 */
export interface AcpAgentProfileReconcile {
  readonly profiles: readonly AcpAgentProfile[]
  readonly changed: boolean
}

/*
 * 内置 agent 的身份由二进制拥有：起哪个程序、带哪些参数、把受控 home 与代填密钥注入
 * 到哪个变量名、以及它自己那份 home 叫什么。用户改不了这些，也没有理由改 —— 改了只会
 * 让界面与真正被 spawn 的进程说两套话。
 *
 * 用户拥有的是另外三格：cwd、env、defaultConfigOptions。物化不碰它们。
 */
function sameLaunchIdentity(profile: AcpAgentProfile, builtin: AcpAgentProfile): boolean {
  return (
    profile.displayName === builtin.displayName &&
    profile.command === builtin.command &&
    profile.args.length === builtin.args.length &&
    profile.args.every((arg, index) => arg === builtin.args[index]) &&
    profile.homeVar === builtin.homeVar &&
    profile.registryKeyVar === builtin.registryKeyVar &&
    profile.ownHomeDirectory === builtin.ownHomeDirectory &&
    sameInstall(profile.install, builtin.install)
  )
}

/* 安装方式也归二进制：改了包名只会让界面装一个东西、进程起另一个东西。 */
function sameInstall(profile?: AcpAgentInstall, builtin?: AcpAgentInstall): boolean {
  if (profile === undefined || builtin === undefined) {
    return profile === builtin
  }

  return (
    profile.packageName === builtin.packageName &&
    profile.versionArgs.length === builtin.versionArgs.length &&
    profile.versionArgs.every((arg, index) => arg === builtin.versionArgs[index])
  )
}

/**
 * 把落盘的档案与二进制里的内置档案对齐。
 *
 * agents.json 是内置档案的一份物化，不是它的第二个来源。每次读都重新物化，于是
 * 「二进制升级了、磁盘没升级」这一整类问题不存在：给档案新增一个字段不需要迁移代码，
 * 也不需要用户删文件。上一版只在文件为空时写一次，那份拷贝因此永远停在用户第一次
 * 启动的那个版本 —— 后来加的 registryKeyVar 到不了磁盘，界面就说这个 agent 没有声明
 * 该往哪个环境变量注入密钥。
 *
 * 陌生 id 原样保留 —— 那是用户自带的 agent，不在二进制的管辖范围内。名单里有、磁盘上
 * 没有的补上：接第二家 agent 时它得自己出现，而不是只对新用户出现。
 */
export function reconcileAcpAgentProfiles(
  profiles: readonly AcpAgentProfile[],
): AcpAgentProfileReconcile {
  const builtins = builtinAcpAgentProfiles()
  let changed = false

  const merged = profiles.map((profile) => {
    const builtin = builtins.find((one) => one.id === profile.id)

    if (!builtin || sameLaunchIdentity(profile, builtin)) {
      return profile
    }

    changed = true

    return {
      ...profile,
      displayName: builtin.displayName,
      command: builtin.command,
      args: [...builtin.args],
      homeVar: builtin.homeVar,
      registryKeyVar: builtin.registryKeyVar,
      ownHomeDirectory: builtin.ownHomeDirectory,
      install: builtin.install,
    }
  })

  const missing = builtins.filter((builtin) => !merged.some((one) => one.id === builtin.id))

  return { profiles: [...merged, ...missing], changed: changed || missing.length > 0 }
}
