import type { AutomationTrigger } from '@poietica/ipc'
import { cn, Select } from '@poietica/ui'
import { useState } from 'react'

import {
  describeMoment,
  describeTrigger,
  INTERVAL_UNITS,
  type IntervalUnit,
  joinInterval,
  MIN_INTERVAL_MINUTES,
  nextRunAfter,
  splitInterval,
  toClock,
  toMinuteOfDay,
} from '../automation'

/*
 * 「什么时候跑」这一块。
 *
 * 单位是这里的主角。上一版只有一个光秃秃的数字框，「分钟」两个字在整个编辑器
 * 里一次都没出现过 —— 人得先保存、回到列表、看那一列才知道自己填的是什么。
 *
 * 三个子取值（档位、数量、时刻）住在这里，不住在编辑器里：编辑器要的是一个
 * AutomationTrigger，不是三个零件。切到「手动」再切回来，数量与时刻还在，
 * 因为它们没被清空过 —— 那是人刚刚才填的东西。
 *
 * 初值只在挂载时取一次 props：换一条自动化时，编辑器那一层已经用 key 重挂过
 * 整棵树（automations-surface.tsx 的 key={editing.id}），所以这里不需要再养
 * 一套「props 变了怎么办」的同步逻辑。
 */

const KINDS: readonly { readonly kind: AutomationTrigger['kind']; readonly label: string }[] = [
  { kind: 'manual', label: '手动' },
  { kind: 'interval', label: '按间隔' },
  { kind: 'daily', label: '每天' },
]

const FIELD = cn(
  'h-[26px] rounded-lg bg-sidebar-accent/50 px-2',
  'text-xs tabular-nums text-foreground',
  'outline-none transition-colors',
  'hover:bg-sidebar-accent',
  'focus-visible:ring-2 focus-visible:ring-ring',
)

const NUMBER_FIELD = cn(FIELD, 'w-14 text-center')

const PILL = cn('bg-sidebar-accent/50 hover:bg-sidebar-accent data-[popup-open]:bg-sidebar-accent')

/** 三个零件 → 一个触发条件。穷尽 switch，没有 default。 */
function compose(
  kind: AutomationTrigger['kind'],
  size: string,
  unit: IntervalUnit,
  atTime: string,
): AutomationTrigger {
  switch (kind) {
    case 'manual':
      return { kind: 'manual' }

    case 'interval':
      return { kind: 'interval', everyMinutes: joinInterval(Number(size), unit) }

    case 'daily':
      return { kind: 'daily', atMinuteOfDay: toMinuteOfDay(atTime) }
  }
}

export interface AutomationTriggerFieldProps {
  readonly onChange: (trigger: AutomationTrigger) => void
  readonly trigger: AutomationTrigger
}

export function AutomationTriggerField({ onChange, trigger }: AutomationTriggerFieldProps) {
  const seed = trigger.kind === 'interval' ? splitInterval(trigger.everyMinutes) : null

  const [kind, setKind] = useState<AutomationTrigger['kind']>(trigger.kind)
  const [size, setSize] = useState(String(seed?.size ?? 1))
  const [unit, setUnit] = useState<IntervalUnit>(seed?.unit ?? 'hour')
  const [atTime, setAtTime] = useState(
    trigger.kind === 'daily' ? toClock(trigger.atMinuteOfDay) : '09:00',
  )

  /* 每个 setter 都把「改完之后的那一份」算出来交上去：不用 effect 去追状态，
     那会多一帧，而且很容易变成一个自己喂自己的循环。 */
  function pickKind(next: AutomationTrigger['kind']): void {
    setKind(next)
    onChange(compose(next, size, unit, atTime))
  }

  function pickSize(next: string): void {
    setSize(next)
    onChange(compose(kind, next, unit, atTime))
  }

  function pickUnit(next: IntervalUnit): void {
    setUnit(next)
    onChange(compose(kind, size, next, atTime))
  }

  function pickTime(next: string): void {
    setAtTime(next)
    onChange(compose(kind, size, unit, next))
  }

  const preview = compose(kind, size, unit, atTime)
  const next = nextRunAfter(preview, Date.now())

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg bg-sidebar-accent/50 p-0.5">
          {KINDS.map((entry) => (
            <button
              aria-pressed={kind === entry.kind}
              className={cn(
                'rounded-[7px] px-3 py-1 text-xs transition-colors',
                kind === entry.kind
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              key={entry.kind}
              onClick={() => {
                pickKind(entry.kind)
              }}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>

        {kind === 'interval' ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>每</span>

            <input
              aria-label="间隔数量"
              className={NUMBER_FIELD}
              inputMode="numeric"
              min={MIN_INTERVAL_MINUTES}
              onChange={(event) => {
                pickSize(event.target.value)
              }}
              type="number"
              value={size}
            />

            <Select
              className={PILL}
              data={INTERVAL_UNITS}
              onValueChange={pickUnit}
              type="间隔单位"
              value={unit}
            />

            <span>运行一次</span>
          </div>
        ) : null}

        {kind === 'daily' ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>每天</span>

            <input
              aria-label="运行时刻"
              className={FIELD}
              onChange={(event) => {
                pickTime(event.target.value)
              }}
              type="time"
              value={atTime}
            />

            <span>运行一次</span>
          </div>
        ) : null}
      </div>

      {/* 预览不是装饰：单位、下限与本地时区三件事，只有在这句话里才看得见。 */}
      <p className="mt-3 text-xs text-muted-foreground">
        {next === null
          ? '不排期。只有你按下运行时才跑一次。'
          : `${describeTrigger(preview)} · 下一次 ${describeMoment(next)}`}
      </p>
    </div>
  )
}
