import type { SessionConfigControl, SessionConfigPurpose } from '@poietica/agent-protocol'
import { useSyncExternalStore } from 'react'

/*
 * 「有哪些模型可选」属于这个 agent，不属于某一条会话。
 *
 * session-config-contract.ts 的文件头把它写成了会话的属性（"what the running
 * session lets us change"），于是能力表唯一的到达口是 port.open(threadId)：
 * 必须先有一条对话、先 spawn 进程握两趟手，才知道有哪些模型。后果有三个：
 *
 *   · 入口那一格恒为 NO_CONTROLS，模型选择器根本没有数据可画（这就是那个
 *     "新建会话没有模型选择器"）；
 *   · 每条对话各问一遍同一张表；
 *   · 有人为了绕开它，把 onIdentify 挂在 onPointerEnter 上偷偷开一条真对话 ——
 *     那个补丁就是输入框乱跳的源头。
 *
 * 这里把三件生命周期不同的事分开：
 *
 *   · 能力表：属于进程。谁报回来的都算，学一次，全进程共用，跨启动缓存。
 *   · 偏好：属于用户，持久。入口那一格画的就是它，不需要任何会话。
 *   · 当前生效值：属于那一条会话，仍由 ThreadsStore 按 threadId 保管。
 *
 * 行业对照：ChatGPT / Claude / Cursor / VS Code Copilot Chat 的新会话界面模型
 * 选择器一直在，画的是偏好，新会话继承它。ACP 自己也把能力放在 initialize
 * 阶段，只有当前选中值是 per-session。
 *
 * 仍欠：线路上没有 initialize 阶段的能力上报，所以全新安装、一条对话都没开过
 * 时这张表是空的。缓存在这里是权宜；正确的家是一个 preferences 端口加一次
 * initialize 上报。
 */

const TABLE_KEY = 'poietica.agent.controls'
const CHOICE_KEY = 'poietica.agent.control-choice'

const PURPOSES: readonly string[] = ['model', 'thought', 'mode', 'other']

const NO_CONTROLS: readonly SessionConfigControl[] = []

function store(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    /* 隐私模式、或没有 DOM 的测试环境。缓存缺席不是错误。 */
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 把缓存读回来，逐字段验。缓存是不可信输入，和 agent 一样。 */
function parseTable(raw: string | null): readonly SessionConfigControl[] {
  if (raw === null) {
    return NO_CONTROLS
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return NO_CONTROLS
  }

  if (!Array.isArray(parsed)) {
    return NO_CONTROLS
  }

  const controls: SessionConfigControl[] = []

  for (const entry of parsed) {
    if (!isRecord(entry)) {
      return NO_CONTROLS
    }

    const { choices, current, id, label, purpose } = entry

    if (
      typeof id !== 'string' ||
      typeof label !== 'string' ||
      typeof current !== 'string' ||
      typeof purpose !== 'string' ||
      !PURPOSES.includes(purpose) ||
      !Array.isArray(choices)
    ) {
      return NO_CONTROLS
    }

    const offered: Array<{ value: string; label: string }> = []

    for (const choice of choices) {
      if (
        !isRecord(choice) ||
        typeof choice.value !== 'string' ||
        typeof choice.label !== 'string'
      ) {
        return NO_CONTROLS
      }

      offered.push({ value: choice.value, label: choice.label })
    }

    controls.push({
      id,
      label,
      purpose: purpose as SessionConfigPurpose,
      current,
      choices: offered,
    })
  }

  return controls
}

function parseChoice(raw: string | null): Readonly<Record<string, string>> {
  if (raw === null) {
    return {}
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }

  if (!isRecord(parsed)) {
    return {}
  }

  const chosen: Record<string, string> = {}

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      chosen[key] = value
    }
  }

  return chosen
}

let table: readonly SessionConfigControl[] = parseTable(store()?.getItem(TABLE_KEY) ?? null)
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

    return wanted === undefined || wanted === control.current
      ? control
      : { ...control, current: wanted }
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

/**
 * 一条会话报回来了它的表。那就是这个 agent 的表。
 *
 * 只在形状真的变了时才换：同一张表被十条对话各报一次，是常态。
 */
export function learnAgentControls(offered: readonly SessionConfigControl[]): void {
  if (offered.length === 0) {
    return
  }

  const before = JSON.stringify(table.map(shapeOf))
  const after = JSON.stringify(offered.map(shapeOf))

  if (before === after) {
    return
  }

  table = offered.map((control) => ({ ...control }))
  persist(TABLE_KEY, table)
  publish()
}

function shapeOf(control: SessionConfigControl): unknown {
  return {
    id: control.id,
    label: control.label,
    purpose: control.purpose,
    choices: control.choices.map((choice) => ({ value: choice.value, label: choice.label })),
  }
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

/** 入口那一格（以及任何还没拿到会话表的那一格）要画的选择器。 */
export function useAgentControls(): readonly SessionConfigControl[] {
  return useSyncExternalStore(subscribeAgentControls, readAgentControls)
}

function subscribeAgentControls(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function readAgentControls(): readonly SessionConfigControl[] {
  return snapshot
}
