import type { Automation, AutomationTrigger } from '@poietica/ipc'

/**
 * 自动化的纯函数层。
 *
 * 没有 React、没有 IPC、没有状态：这一层只回答「下一次什么时候到期」「这堆
 * 记录合起来是什么样子」「这条触发条件念出来是什么」。形状本身不在这里声明 ——
 * 它的权威是 Rust 侧的 commands/automations.rs，经由生成绑定过来。
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const SUMMARY_WINDOW = 7 * DAY

/** 账本只留最近这么多次。再往前的正文仍在各自那条对话里。 */
export const RUN_HISTORY_LIMIT = 50

/**
 * 从 from 起，这条自动化下一次该在什么时候跑。
 *
 * manual 返回 null，而不是一个「永远不到的极大值」—— 那种写法会在此后每一处
 * 比较里活下来，并且总有一天会被某个减法算成一个荒谬的间隔。
 */
export function nextRunAfter(trigger: AutomationTrigger, from: number): string | null {
  switch (trigger.kind) {
    case 'manual':
      return null

    case 'interval':
      return new Date(from + trigger.everyMinutes * MINUTE).toISOString()

    case 'daily':
      /* 本地时间：人说「每天九点」说的是自己表上的九点。 */
      return wallClockAfter(trigger.atMinuteOfDay, from).toISOString()
  }
}

/**
 * 本地墙钟上，from 之后第一个 atMinuteOfDay 时刻。
 *
 * 日历运算，不是绝对时间加法：setHours 与 setDate 按本地日历走，夏令时切换
 * 那一天（23 或 25 小时）落点仍然是表上那个时刻 —— cron 与 Temporal 的日程
 * 都以墙钟为准，「每天 9 点」在切换日也是 9 点。此前是
 * midnight.getTime() + atMinuteOfDay * MINUTE：往一个绝对时刻上加九个小时，
 * 切换日落到的就是 8 点或 10 点，与那段注释自己的承诺正好相反。
 */
function wallClockAfter(atMinuteOfDay: number, from: number): Date {
  const at = new Date(from)

  at.setHours(Math.floor(atMinuteOfDay / 60), atMinuteOfDay % 60, 0, 0)

  if (at.getTime() <= from) {
    at.setDate(at.getDate() + 1)
  }

  return at
}

/**
 * 锚定计划序列里，now 之后的第一次。
 *
 * 锚点是上一次排定的时刻，不是上一次跑完的时刻 —— 固定速率，不是固定延迟：
 * 「每小时」的一次跑了五分钟，下一次仍在原计划的点上；锚定完成时刻是
 * scheduleWithFixedDelay 的语义，日程随每次执行越推越歪。cron、Temporal 与
 * Kubernetes CronJob 用的都是锚定序列。关机错过的次数不逐次补：序列直接跨到
 * now 之后的第一个，到期的那一次由 check() 点火一次，更早的不补 —— 与
 * CronJob 的 misfire 处理同法。
 */
export function nextOccurrence(
  trigger: AutomationTrigger,
  anchor: number,
  now: number,
): string | null {
  switch (trigger.kind) {
    case 'manual':
      return null

    case 'interval': {
      const span = trigger.everyMinutes * MINUTE
      const steps = Math.max(0, Math.floor((now - anchor) / span) + 1)

      return new Date(anchor + steps * span).toISOString()
    }

    case 'daily': {
      let next = wallClockAfter(trigger.atMinuteOfDay, anchor).getTime()

      while (next <= now) {
        next = wallClockAfter(trigger.atMinuteOfDay, next).getTime()
      }

      return new Date(next).toISOString()
    }
  }
}

export interface AutomationSummary {
  readonly total: number
  readonly succeeded: number
  readonly failed: number
}

/** 顶部那三块牌子。窗口 7 天。 */
export function summarize(
  automations: readonly Automation[],
  now: number = Date.now(),
): AutomationSummary {
  let succeeded = 0
  let failed = 0

  for (const automation of automations) {
    for (const run of automation.runs) {
      if (now - Date.parse(run.startedAt) > SUMMARY_WINDOW) {
        continue
      }

      if (run.outcome === 'succeeded') {
        succeeded += 1
      } else {
        failed += 1
      }
    }
  }

  return { total: automations.length, succeeded, failed }
}

/*
 * 间隔的单位。
 *
 * 线上只有 everyMinutes 一个数（权威是 commands/automations.rs 的
 * AutomationTrigger）。单位是界面上的事，不进存储：存成「数量 + 单位」两个
 * 字段，就等于允许这两个字段各自被改成互相矛盾的样子，而「90 分钟」和
 * 「1.5 小时」本来就是同一张时刻表。
 *
 * 没有秒。心跳 TICK 是 30 秒（automation-store.ts），nextRunAfter 也只按
 * 分钟落点 —— 写上「每 10 秒」就是承诺一个这套调度兑现不了的精度。界面只
 * 摆能兑现的那几档。
 */
const UNIT_MINUTES = { minute: 1, hour: 60, day: 24 * 60 } as const

export type IntervalUnit = keyof typeof UNIT_MINUTES

const UNIT_LABELS: Record<IntervalUnit, string> = {
  minute: '分钟',
  hour: '小时',
  day: '天',
}

/** 下拉里的那几行，从小到大 —— 人读时间的顺序。 */
export const INTERVAL_UNITS: readonly { readonly value: IntervalUnit; readonly label: string }[] = [
  { value: 'minute', label: UNIT_LABELS.minute },
  { value: 'hour', label: UNIT_LABELS.hour },
  { value: 'day', label: UNIT_LABELS.day },
]

/** 调度能兑现的最小间隔。下限在这里收口，输入框因此不必自己防守。 */
export const MIN_INTERVAL_MINUTES = 1

/** 新建时的默认触发条件。BLANK_DRAFT 从这里取，「默认是每天九点」只写一处。 */
export const DEFAULT_TRIGGER: AutomationTrigger = { kind: 'daily', atMinuteOfDay: 9 * 60 }

/**
 * 把分钟数还原成人当初写它时用的那个单位。
 *
 * 从大往小取第一个整除的：120 是「2 小时」，90 只能是「90 分钟」。存进去
 * 什么样，再打开还是什么样 —— 少了这一步，每打开一次编辑器，界面就把用户
 * 说过的话重新措辞一遍。
 */
export function splitInterval(everyMinutes: number): {
  readonly size: number
  readonly unit: IntervalUnit
} {
  const descending: readonly IntervalUnit[] = ['day', 'hour', 'minute']

  for (const unit of descending) {
    const span = UNIT_MINUTES[unit]

    if (everyMinutes >= span && everyMinutes % span === 0) {
      return { size: everyMinutes / span, unit }
    }
  }

  return { size: Math.max(MIN_INTERVAL_MINUTES, everyMinutes), unit: 'minute' }
}

/**
 * 反过来。
 *
 * size 来自 <input type="number">，清空时是空串，Number('') 是 0，而
 * Math.max(1, NaN) 是 NaN —— 非有限值在这里挡住，不让它流进 nextRunAfter
 * 变成一个永远算不出来的下次运行。
 */
export function joinInterval(size: number, unit: IntervalUnit): number {
  const whole = Number.isFinite(size) ? Math.trunc(size) : MIN_INTERVAL_MINUTES

  return Math.max(MIN_INTERVAL_MINUTES, whole * UNIT_MINUTES[unit])
}

/** 一天里的第几分钟 → HH:MM。<input type="time"> 收发的就是这个格式。 */
export function toClock(atMinuteOfDay: number): string {
  const pad = (value: number) => value.toString().padStart(2, '0')

  return `${pad(Math.floor(atMinuteOfDay / 60))}:${pad(atMinuteOfDay % 60)}`
}

/** HH:MM → 一天里的第几分钟。空串归零。 */
export function toMinuteOfDay(clock: string): number {
  const [hours = '0', minutes = '0'] = clock.split(':')

  return Number(hours) * 60 + Number(minutes)
}

export function describeTrigger(trigger: AutomationTrigger): string {
  switch (trigger.kind) {
    case 'manual':
      return '手动'

    case 'interval': {
      const { size, unit } = splitInterval(trigger.everyMinutes)

      return `每 ${size} ${UNIT_LABELS[unit]}`
    }

    case 'daily':
      return `每天 ${toClock(trigger.atMinuteOfDay)}`
  }
}

/**
 * 两个触发条件是不是同一个。
 *
 * 存在的理由只有一个：编辑一条已有的自动化时，只有触发条件真的变了才该重排
 * 下一次运行。无脑重算的话，改一个错别字就会把 interval 那条的下一次推后
 * 一整个周期 —— 人只动了提示词，日程却被挪走了。
 *
 * 穷尽 switch，没有 default：将来多一种触发条件，编译器会在这里拦住。
 */
export function sameTrigger(left: AutomationTrigger, right: AutomationTrigger): boolean {
  switch (left.kind) {
    case 'manual':
      return right.kind === 'manual'

    case 'interval':
      return right.kind === 'interval' && left.everyMinutes === right.everyMinutes

    case 'daily':
      return right.kind === 'daily' && left.atMinuteOfDay === right.atMinuteOfDay
  }
}

/**
 * 两份会话设置是不是同一份。
 *
 * 与 sameTrigger 同一个用途：编辑器判「有没有改过」。键集合取并集，不是拿
 * 一边的键去查另一边 —— 那样「删掉一项」会被判成没变，保存按钮永远是灰的。
 *
 * 两边都必须是收过的形状（sessionConfigOf 的产物）。收窄入参不是洁癖：生成
 * 绑定里 sessionConfig 是 Partial<Record<..>> | undefined，直接递进来编译就
 * 过不去 —— 于是「忘记归一」这件事由编译器拦，不靠人记得。
 */
export function sameSessionConfig(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (left[key] !== right[key]) {
      return false
    }
  }

  return true
}

/**
 * 一份还没有身份的自动化：编辑器里能改的全部，正好就是这四样。
 *
 * 住在纯函数层而不是 store 里 —— 它是这个领域的词汇，不是某一个状态容器的
 * 私事。store 收它、模板摊出它、编辑器读它，三方共用一个名字，就不会长出
 * 三份形状相近的初始化结构。
 */
export interface AutomationDraft {
  readonly title: string
  readonly prompt: string
  readonly trigger: AutomationTrigger
  /**
   * 这条自动化要给自己那次运行改掉的会话设置。
   *
   * 键是 agent 报的 controlId，值是它自己的词汇。这一层不认识这些字符串，
   * 也不该认识 —— 校验的唯一时机是下发那一刻，由 agent 自己说了算。
   *
   * 空表是一个正常取值，不是「还没填」：不改动，用 agent 当下的默认。模板
   * 给的就是空表，所以编辑器打开时显示的是 agent 此刻报的组合，人按下保存，
   * 存进去的就是屏幕上那三颗胶囊 —— 界面上没有「跟随默认」这一档，这里也
   * 没有第三态。
   */
  readonly sessionConfig: Readonly<Record<string, string>>
}

/** 直接新建时表单里的东西。和模板给的那一份是同一种形状，不是另一条初始化路径。 */
export const BLANK_DRAFT: AutomationDraft = {
  title: '',
  prompt: '',
  trigger: DEFAULT_TRIGGER,
  sessionConfig: {},
}

/**
 * 把线上那个形状收成界面能用的形状。
 *
 * 生成绑定里 sessionConfig 是 Partial<Record<..>> | undefined，那是 BTreeMap
 * 加 #[serde(default)] 的忠实翻译：老盘上的记录整张表都可能缺席，每个值也
 * 标成可选。线上如此没有错，但界面不该一路背着它走 —— 边界上收一次，往里
 * 只有 Record<string, string>。
 *
 * 此前编辑器自己在 pickedFrom 里收一次、判「有没有改过」时忘了收、运行时
 * 那一侧干脆没收：同一件事在三处各做一遍，漏一遍就是一个类型错误。
 */
export function sessionConfigOf(automation: Automation): Readonly<Record<string, string>> {
  const picked: Record<string, string> = {}

  for (const [id, value] of Object.entries(automation.sessionConfig ?? {})) {
    if (value !== undefined) {
      picked[id] = value
    }
  }

  return picked
}

/** 把一条已有的自动化摊回成草稿。编辑器要的初值就是它。 */
export function draftOf(automation: Automation): AutomationDraft {
  return {
    title: automation.title,
    prompt: automation.prompt,
    trigger: automation.trigger,
    sessionConfig: sessionConfigOf(automation),
  }
}

/*
 * 相对时间交给平台。
 *
 * Intl.RelativeTimeFormat 是标准库：手写一张「秒/分/时/天」的表，等于自己承担
 * 复数、语言与取整三件事，而这三件事运行时已经做完了。
 */
const RELATIVE = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

const UNITS = [
  { unit: 'day', span: DAY },
  { unit: 'hour', span: HOUR },
  { unit: 'minute', span: MINUTE },
] as const

export function describeMoment(at: string, now: number = Date.now()): string {
  const delta = Date.parse(at) - now

  for (const { unit, span } of UNITS) {
    if (Math.abs(delta) >= span) {
      return RELATIVE.format(Math.trunc(delta / span), unit)
    }
  }

  return RELATIVE.format(0, 'minute')
}

/** 「最近运行」那一列。没跑过就是没跑过，不编一个占位出来。 */
export function latestRun(automation: Automation): Automation['runs'][number] | null {
  return automation.runs[0] ?? null
}
