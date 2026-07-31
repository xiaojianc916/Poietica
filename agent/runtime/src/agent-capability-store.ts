import type { AgentCapabilityPort, SessionConfigControl } from '@poietica/agent-protocol'
import { useSyncExternalStore } from 'react'
import * as v from 'valibot'

/*
 * 「有哪些模型可选」属于这个 agent，不属于某一条会话。
 *
 * session-config-contract.ts 的文件头把它写成了会话的属性（"what the running
 * session lets us change"），于是能力表唯一的到达口是 port.open(threadId)：
 * 必须先有一条对话、先 spawn 进程握两趟手，才知道有哪些模型。后果有三个：
 *
 *   · 入口那一格恒为空，模型选择器根本没有数据可画；
 *   · 每条对话各问一遍同一张表；
 *   · 有人为绕开它，把 onIdentify 挂在 onPointerEnter 上偷偷开一条真对话 ——
 *     那个补丁就是输入框乱跳的源头。
 *
 * 这里把三件生命周期不同的事分开：
 *
 *   · 能力表：属于进程。谁报回来的都算，学一次，全进程共用，跨启动缓存。
 *   · 选中的那个值：属于 agent 自己的配置（顶层 default_model），一处。
 *   · 当前生效值：属于那一条会话，仍由 ThreadsStore 按 threadId 保管。
 *
 * 行业对照：ChatGPT / Claude / Cursor / VS Code Copilot Chat 的新会话界面模型
 * 到达口现在是一个端口：AgentCapabilityPort。谁都可以问它，不需要会话、也不需要
 * 对话；原生侧 agent_capabilities 问的是连接自己的锚会话，不新开会话、不写库。
 * 进程仍然按需才起 —— 第一个订阅者出现时才问一次（见 loadOnce），一个从没打开
 * 过助手的启动不为此付钱。
 *
 * localStorage 那一份只是离线兜底，画首帧用；它不是任何东西的真相。"人选了哪个
 * 模型"的家是 agent 自己配置里的 default_model —— 上游的 TUI 也是这么做的：
 * apps/kimi-code/src/tui/commands/config.ts 的 showModelPicker 主回调逐字是
 * performModelSwitch(host, alias, thinking, true)，末位那个 true 就是落盘。
 */

const TABLE_KEY = 'poietica.agent.controls'

const NO_CONTROLS: readonly SessionConfigControl[] = []

function store(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    /* 隐私模式、或没有 DOM 的测试环境。缓存缺席不是错误。 */
    return null
  }
}

/*
 * 缓存是不可信输入，和 agent 报回来的东西一样，所以它有一份模式。
 *
 * 此前这里是一百行手写探针：isRecord 收窄出索引签名，再逐层解构加 typeof。
 * 接口写一遍、校验写一遍，两份靠人对齐 —— 加一格而忘了补校验时编译器一声不吭，
 * 它只是静默地不再校验那一格。
 *
 * valibot 已经在 catalog 里，隔壁的 acp-agent-profile.ts 早就是这么写的；
 * 这个包只是没跟上。模式即文档，类型由模式推出，漏一格是编译错误。
 *
 * 有一处不合规就整份作废：半张表比没有表更难查，这与此前的取舍一致。
 */
const ShapeSchema = v.object({
  id: v.string(),
  label: v.string(),
  purpose: v.picklist(['model', 'thought', 'mode', 'other']),
  choices: v.array(v.object({ value: v.string(), label: v.string() })),
})

const TableSchema = v.array(ShapeSchema)

/*
 * 缓存里的一项：没有 current。
 *
 * 这不是精简，是纠正。shapeOf 从来就没把 current 算进这张表的身份 —— 也就是说
 * 代码自己早就认定它不属于这张表，只是当初仍然把它一起写进了 localStorage。
 * 后果是「人选了哪个模型」有了第二个家，而那个家跨启动、有两个写入口、谁都不校验：
 * 打开一条记着别的模型的旧对话，就会顺着 learnAgentControls 的整份换表把它覆盖掉，
 * 而配置里的 default_model 一动不动。于是入口那一格与设置页各说各的，两个都"忠实
 * 显示"，只是显示的不是同一个东西。
 */
type ControlShape = v.InferOutput<typeof ShapeSchema>

const NO_SHAPES: readonly ControlShape[] = []

/** 解析一段落盘的 JSON；坏了就当没有。 */
function revive<TSchema extends v.GenericSchema>(
  schema: TSchema,
  raw: string | null,
): v.InferOutput<TSchema> | undefined {
  if (raw === null) {
    return undefined
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }

  const checked = v.safeParse(schema, parsed)

  return checked.success ? checked.output : undefined
}

function parseTable(raw: string | null): readonly ControlShape[] {
  return revive(TableSchema, raw) ?? NO_SHAPES
}

let table: readonly ControlShape[] = parseTable(store()?.getItem(TABLE_KEY) ?? null)

/*
 * 每一项此刻是什么值 —— 模型那一项除外。
 *
 * 只在内存里。这些值的权威是 agent，它每开一条会话就报一次；跨启动留着上一次的
 * 残留没有意义，反而会在 agent 那边被人改过之后继续显示旧值。
 */
const reported = new Map<string, string>()

/*
 * 模型那一项选中什么。它的家是 agent 自己配置里的 default_model，这里只是那个值
 * 的一份内存镜像，由 installAgentDefaultModelSource 问回来、由选择器拨动时更新。
 *
 * 不落 localStorage：落了就又是第二个家。还没问到之前是 null，那时退回 agent 报
 * 过的值或第一个候选，只为让首帧有东西可画。
 */
let chosenModel: string | null = null

/*
 * 现有那张表的形状签名。
 *
 * "同一张表被十条对话各报一次"是常态(见 learnAgentControls 的注释),也就是说那
 * 条路径注定被重复调用、且注定在"没变"处返回。此前每一次都把现有的表重新 map
 * 一遍再 stringify 一遍才得出这个结论 —— 一个不变量被反复重算。表变了才更新它。
 *
 * 这里用 JSON.stringify 做相等判据是可靠的,只因为 shapeOf 显式构造对象、键序
 * 固定;它不是通用的深比较。
 */
let signature = JSON.stringify(table.map(shapeOf))

/*
 * 这一项现在该显示什么值。
 *
 * 模型那一项只认 default_model 的镜像：入口与新建对话那一格问的是"下一条对话从
 * 哪个模型起步"，那个问题的答案只写在配置文件里。agent 为某一条旧对话报回来的值
 * 不参与 —— 那是那条对话的历史，不是全局的起点。这一行就是"点进旧对话，回到新建
 * 对话却变成了旧对话那个模型"的正面回答。
 *
 * 其余各项没有落盘的家，仍以 agent 最近一次报的为准。
 */
function currentOf(shape: ControlShape): string {
  const fallback = reported.get(shape.id) ?? shape.choices[0]?.value ?? ''

  if (shape.purpose !== 'model') {
    return fallback
  }

  return chosenModel ?? fallback
}

/*
 * 画出去的表是投影：形状来自缓存，值来自上面那两处。
 *
 * 投影本身是廉价的，而且只在 publish 时算一次，不在每次读取时算 —— useSyncExternalStore
 * 要求快照引用稳定，每次现算会让它认定"状态一直在变"而无限重渲染。
 */
function project(): readonly SessionConfigControl[] {
  return table.length === 0
    ? NO_CONTROLS
    : table.map((shape) => ({ ...shape, current: currentOf(shape) }))
}

let snapshot: readonly SessionConfigControl[] = project()

const listeners = new Set<() => void>()

function publish(): void {
  snapshot = project()

  for (const listener of listeners) {
    listener()
  }
}

function persist(key: string, value: unknown): void {
  try {
    store()?.setItem(key, JSON.stringify(value))
  } catch {
    /* 写不进去就只在这次运行里有效。不值得打断任何事。 */
  }
}

function shapeOf(control: ControlShape | SessionConfigControl): ControlShape {
  return {
    id: control.id,
    label: control.label,
    purpose: control.purpose,
    choices: control.choices.map((option) => ({ value: option.value, label: option.label })),
  }
}

/**
 * 一条会话报回来了它的表。那就是这个 agent 的表。
 *
 * 只在形状真的变了时才换：同一张表被十条对话各报一次，是常态。
 */
export function learnAgentControls(offered: readonly SessionConfigControl[]): void {
  if (offered.length === 0) {
    return
  }

  const shapes = offered.map(shapeOf)
  const offeredSignature = JSON.stringify(shapes)
  let changed = false

  if (offeredSignature !== signature) {
    table = shapes
    signature = offeredSignature
    persist(TABLE_KEY, table)
    changed = true
  }

  /*
   * 报回来的值只进内存，而且模型那一项一个字都不写。
   *
   * 打开一条旧对话就是一次 learnAgentControls。那条对话记着的模型是它自己的事实,
   * 不是"下一条新对话从哪起步"。此前这两件事共用 localStorage 里同一格，于是仅仅
   * 浏览一条旧对话就会永久改掉入口那一格的选中值 —— 而且那条路径一个字都没写
   * default_model，所以设置页与入口从此各说各的。
   *
   * 要改 default_model 只有一条路：人自己在选择器里拨动（setAgentDefaultModel 加
   * 一次落盘）。被动打开一条旧对话不算拨动。
   */
  for (const control of offered) {
    if (control.purpose === 'model' || reported.get(control.id) === control.current) {
      continue
    }

    reported.set(control.id, control.current)
    changed = true
  }

  if (changed) {
    publish()
  }

  /* 候选可能是这一刻才第一次到达的：那正是"该不该替他挑一个"重新有答案的时刻。 */
  ensureDefaultModel()
}

/**
 * 人拨动了模型选择器，或者刚从配置里读到 default_model。
 *
 * 这是一次乐观更新，不是一份偏好。真值在 agent 自己的 config.toml 里（顶层
 * default_model），写它的是调用方；agent watch 着那个文件，但 watcher 有延迟，
 * 所以这里不等它、也不回读，先把屏幕上那一格改对。
 *
 * 不落 localStorage。整个问题的病根就是这个值曾经有一份自己的落盘副本。
 */
export function setAgentDefaultModel(alias: string | null): void {
  if (chosenModel === alias) {
    return
  }

  chosenModel = alias
  publish()
}

/**
 * 此刻选中的是哪个模型。
 *
 * 会话那一侧要拿它把自己对齐过来：一条旧对话记着别的模型是它自己的历史，不是"现在
 * 选中什么"的答案。这个函数就是那个答案唯一的产地。
 */
export function agentDefaultModel(): string | null {
  return chosenModel
}

/*
 * 一个模型都没选中时，替他挑一个。
 *
 * 这是「配好了密钥、模型也列出来了，一发消息却说 Authentication required」的根治：
 * 上游 hasUsableConfiguredDefaultModel 第一行就是 config.defaultModel === undefined
 * 时 return false，于是配置文件里的 api_key 整条不算数 —— 而屏幕上模型列得好好的，
 * 故障现场与病因之间没有任何可见的联系。
 *
 * 它属于这里，不属于设置页。此前那一版写在 ModelsSettings 里，意思是"不打开设置页
 * 就不补"，可开不了会话的是主界面。挑第一个候选是稳定的：快照在 agent-provider-state
 * 里按 provider id 排过序，同一份配置每次挑到的是同一个。
 *
 * 挑出来的这个只是个起点，不是偏好 —— 人在选择器里拨一下它就变了。
 */
function ensureDefaultModel(): void {
  const save = defaultSource?.save

  if (!defaultKnown || chosenModel !== null || save === undefined) {
    return
  }

  const first = table.find((shape) => shape.purpose === 'model')?.choices[0]?.value

  if (first === undefined) {
    return
  }

  setAgentDefaultModel(first)

  void save(first).catch(() => {
    /* 没写进去就当没挑过：下一条会话报表时会再试一次，而不是让屏幕显示一个文件里没有的值。 */
    setAgentDefaultModel(null)
  })
}

/*
 * 能力表从哪里来，以及什么时候去问。
 *
 * 端口在启动接线时装上，装上本身不起进程：它只是一个会打命令的对象。真正那次
 * 读取要等第一个订阅者出现 —— 也就是屏幕上真的有一个选择器要画的时候。原生侧
 * 那条命令的文档写着「一个从没打开过助手的启动不该为此付钱」，这里就是那句话
 * 在渲染侧的落点。
 *
 * 失败之后把 asked 放回去：下一次有人要看选择器时会再问一次，而不是让一次开机
 * 时的失败永久变成一张空表。
 */
let source: AgentCapabilityPort | undefined

let asked = false

let report: ((cause: unknown) => void) | undefined

/*
 * default_model 从哪里读、往哪里写。
 *
 * 这个包不认识 AgentConfigStore，也不该认识 —— 它只要两个函数：问一次，和写一次。
 */
interface DefaultModelSource {
  readonly load: () => Promise<string | null>
  readonly save: (alias: string) => Promise<unknown>
}

let defaultSource: DefaultModelSource | undefined

let askedDefault = false

/*
 * 那一次读取回来过没有。
 *
 * 不能拿 chosenModel === null 当这个问题的答案：还没问到的时候它也是 null，而自动
 * 补齐正是靠这个判断决定要不要写入 —— 分不清「确实没有」与「还不知道」，就会拿第一个
 * 候选盖掉人原本配好的那个。只在读取成功时置位。
 */
let defaultKnown = false

/*
 * default_model 从哪里读。
 *
 * 这个包不认识 AgentConfigStore，也不该认识 —— 它只要一个"问一次，给我一个别名"
 * 的函数。装上就问，因为装上的时机已经晚于第一个订阅者；问过就不再问，失败则把
 * 标志放回去，下一次装载会重试。
 */
function loadDefaultOnce(): void {
  const load = defaultSource?.load

  if (askedDefault || load === undefined) {
    return
  }

  askedDefault = true
  load()
    .then((alias) => {
      defaultKnown = true
      setAgentDefaultModel(alias)
      ensureDefaultModel()
    })
    .catch(() => {
      askedDefault = false
    })
}

/** 接线时交进来：怎么读、怎么写 agent 配置里的 default_model。 */
export function installAgentDefaultModelSource(source: DefaultModelSource): void {
  defaultSource = source
  loadDefaultOnce()
}

/** 接线时装上能力端口。装上不问，问在第一个订阅者出现时。 */
export function installAgentCapabilityPort(
  port: AgentCapabilityPort,
  onFailure?: (cause: unknown) => void,
): void {
  source = port
  report = onFailure
}

function loadOnce(): void {
  const port = source

  if (asked || port === undefined) {
    return
  }

  asked = true
  port
    .read()
    .then((offered) => {
      learnAgentControls(offered)
    })
    .catch((cause: unknown) => {
      asked = false
      report?.(cause)
    })
}

/**
 * 只听，不问。
 *
 * 与 subscribeAgentControls 的区别只有一处，但那一处要紧：这个不调 loadOnce。
 * 挂一个监听器不该把 agent 进程拉起来 —— 会话那一侧在应用启动时就要听着默认模型
 * 的变化，而那时屏幕上可能一个选择器都还没有。「一个从没打开过助手的启动不为此
 * 付钱」这条约束，在这里同样成立。
 */
export function observeAgentControls(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function subscribeAgentControls(listener: () => void): () => void {
  listeners.add(listener)
  loadOnce()
  loadDefaultOnce()

  return () => {
    listeners.delete(listener)
  }
}

function readAgentControls(): readonly SessionConfigControl[] {
  return snapshot
}

/** 入口那一格（以及任何还没拿到会话表的那一格）要画的选择器。 */
export function useAgentControls(): readonly SessionConfigControl[] {
  return useSyncExternalStore(subscribeAgentControls, readAgentControls)
}
