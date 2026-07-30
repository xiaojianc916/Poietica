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
 *   · 偏好：属于用户，持久。入口那一格画的就是它，不需要任何会话。
 *   · 当前生效值：属于那一条会话，仍由 ThreadsStore 按 threadId 保管。
 *
 * 行业对照：ChatGPT / Claude / Cursor / VS Code Copilot Chat 的新会话界面模型
 * 到达口现在是一个端口：AgentCapabilityPort。谁都可以问它，不需要会话、也不需要
 * 对话；原生侧 agent_capabilities 问的是连接自己的锚会话，不新开会话、不写库。
 * 进程仍然按需才起 —— 第一个订阅者出现时才问一次（见 loadOnce），一个从没打开
 * 过助手的启动不为此付钱。
 *
 * 仍欠：localStorage 那一份只是离线兜底。偏好的正确的家是一个 preferences 端口，
 * 它和能力表生命周期不同，所以不在这一刀里。
 */

const TABLE_KEY = 'poietica.agent.controls'
const CHOICE_KEY = 'poietica.agent.control-choice'

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

const ChoiceSchema = v.record(v.string(), v.string())

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

function parseChoice(raw: string | null): Readonly<Record<string, string>> {
  return revive(ChoiceSchema, raw) ?? {}
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
let choice: Readonly<Record<string, string>> = parseChoice(store()?.getItem(CHOICE_KEY) ?? null)

/*
 * 入口那一格看到的那张表：能力表，当前值换成偏好。
 *
 * 引用只在真的变了时才更换 —— useSyncExternalStore 用引用相等判断变化。
 */
function project(): readonly SessionConfigControl[] {
  if (table.length === 0) {
    return NO_CONTROLS
  }

  return table.map((control) => {
    const wanted = choice[control.id]

    if (wanted === undefined || wanted === control.current) {
      return control
    }

    return { ...control, current: wanted }
  })
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

/** 人选了一个值。没有会话的时候，这就是一次偏好。 */
export function chooseAgentControl(controlId: string, value: string): void {
  if (choice[controlId] === value) {
    return
  }

  choice = { ...choice, [controlId]: value }
  persist(CHOICE_KEY, choice)
  publish()
}

/** 这一项人想用什么；没表达过就是 undefined。 */
export function preferredAgentControl(controlId: string): string | undefined {
  return choice[controlId]
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
