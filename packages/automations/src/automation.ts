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

    case 'daily': {
      /* 本地时间：人说「每天九点」说的是自己表上的九点。 */
      const midnight = new Date(from)
      midnight.setHours(0, 0, 0, 0)

      const today = midnight.getTime() + trigger.atMinuteOfDay * MINUTE

      return new Date(today > from ? today : today + DAY).toISOString()
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

export function describeTrigger(trigger: AutomationTrigger): string {
  switch (trigger.kind) {
    case 'manual':
      return '手动'

    case 'interval':
      return trigger.everyMinutes % 60 === 0
        ? `每 ${trigger.everyMinutes / 60} 小时`
        : `每 ${trigger.everyMinutes} 分钟`

    case 'daily': {
      const hours = Math.floor(trigger.atMinuteOfDay / 60)
      const minutes = trigger.atMinuteOfDay % 60

      return `每天 ${pad(hours)}:${pad(minutes)}`
    }
  }
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
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
 * 生成绑定给的是 Partial<Record<..>>（Rust 侧是 BTreeMap），所以缺席与
 * undefined 在这里是同一件事，直接比较即可。
 */
export function sameSessionConfig(
  left: Partial<Record<string, string>>,
  right: Partial<Record<string, string>>,
): boolean {
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (left[key] !== right[key]) {
      return false
    }
  }

  return true
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
