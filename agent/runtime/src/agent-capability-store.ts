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
const ControlSchema = v.object({
  id: v.string(),
  label: v.string(),
  purpose: v.picklist(['model', 'thought', 'mode', 'other']),
  current: v.string(),
  choices: v.array(v.object({ value: v.string(), label: v.string() })),
})

const TableSchema = v.array(ControlSchema)

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

function parseTable(raw: string | null): readonly SessionConfigControl[] {
  return revive(TableSchema, raw) ?? NO_CONTROLS
}

let table: readonly SessionConfigControl[] = parseTable(store()?.getItem(TABLE_KEY) ?? null)

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
 * 画出去的就是那张表本身，没有投影。
 *
 * 此前这里把一份 localStorage 偏好覆盖到 current 上，于是同一个问题有两个答案：
 * agent 报回来的 current（它读的是自己配置里的 default_model），和我们自己存的
 * 那一份。两者一分叉，界面就会出现图标是这家、模型是那家。
 *
 * 现在选择器一改就写 default_model，agent 报回来的就是我们刚写下去的那个值。
 */
let snapshot: readonly SessionConfigControl[] = table

const listeners = new Set<() => void>()

function publish(): void {
  snapshot = table

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

function shapeOf(control: SessionConfigControl): unknown {
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

  const offeredSignature = JSON.stringify(offered.map(shapeOf))

  if (offeredSignature === signature) {
    return
  }

  table = offered.map((control) => ({ ...control }))
  signature = offeredSignature
  persist(TABLE_KEY, table)
  publish()
}

/**
 * 人选了一个值：就地记下它，界面立刻改。
 *
 * 这是一次乐观更新，不是一份偏好。真值在 agent 自己的 config.toml 里（顶层
 * default_model），写它的是调用方；agent watch 着那个文件，但 watcher 有延迟，
 * 所以这里不等它、也不回读，先把屏幕上那一格改对。下一次 agent 报表回来，报的
 * 就是我们刚写下去的同一个值。
 *
 * 形状签名不受影响：shapeOf 不含 current，所以这次改动不会被误当成"表变了"。
 */
export function chooseAgentControl(controlId: string, value: string): void {
  const index = table.findIndex((control) => control.id === controlId)
  const control = table[index]

  if (control === undefined || control.current === value) {
    return
  }

  const next = [...table]
  next[index] = { ...control, current: value }
  table = next
  persist(TABLE_KEY, table)
  publish()
}

/** 这一项现在是什么值；表里没有这一项就是 undefined。 */
export function preferredAgentControl(controlId: string): string | undefined {
  return table.find((control) => control.id === controlId)?.current
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

function subscribeAgentControls(listener: () => void): () => void {
  listeners.add(listener)
  loadOnce()

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
