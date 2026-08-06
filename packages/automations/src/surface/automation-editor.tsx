import type { Automation, AutomationTrigger } from '@poietica/ipc'
import { cn } from '@poietica/ui'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { describeMoment, describeTrigger, sameTrigger } from '../automation'
import type { AutomationStore } from '../automation-store'
import { AutomationRunHistory } from './automation-run-history'

/**
 * 一条自动化的编辑器。占满自动化那一格，不开新标签页，也不弹窗。
 *
 * automation 为 null 就是新建 —— 与编辑共用这一屏，因为它们本来就是同一件事：
 * 一份草稿，加一个「这份草稿有没有对应的已存在记录」。
 *
 * 有一处刻意的不一致：启用开关立即生效，标题 / 指令 / 触发要按保存。
 * 那不是漏了 —— 启用是运维开关，不是内容编辑：临时停掉一条正在捣乱的自动化时，
 * 不该被迫先把手里没写完的草稿一起提交。
 */

export interface AutomationEditorProps {
  /** 正在编辑的那一条；null 表示新建。 */
  readonly automation: Automation | null
  readonly onBack: () => void
  readonly store: AutomationStore
}

type EditorTab = 'settings' | 'runs'

export function AutomationEditor({ automation, onBack, store }: AutomationEditorProps) {
  const [tab, setTab] = useState<EditorTab>('settings')
  const [title, setTitle] = useState(automation?.title ?? '')
  const [prompt, setPrompt] = useState(automation?.prompt ?? '')
  const [kind, setKind] = useState<AutomationTrigger['kind']>(automation?.trigger.kind ?? 'daily')
  const [everyMinutes, setEveryMinutes] = useState(
    automation?.trigger.kind === 'interval' ? automation.trigger.everyMinutes : 60,
  )
  const [atTime, setAtTime] = useState(
    automation?.trigger.kind === 'daily' ? toClock(automation.trigger.atMinuteOfDay) : '09:00',
  )

  /*
   * 表单三个字段收束成一个触发条件。
   *
   * time 控件给出的是 "HH:mm"，落进领域时立刻变成「一天里的第几分钟」这个单一
   * 数字 —— 字符串留到领域里，此后每一处比较都得先解析一次，而每一次解析都是
   * 一个可能失败的地方。
   */
  const trigger: AutomationTrigger =
    kind === 'manual'
      ? { kind: 'manual' }
      : kind === 'interval'
        ? { kind: 'interval', everyMinutes }
        : { kind: 'daily', atMinuteOfDay: toMinuteOfDay(atTime) }

  const ready = title.trim().length > 0 && prompt.trim().length > 0

  /* 没改过就没什么可存的。保存键因此不是一个永远亮着、按了也不知道有没有用的键。 */
  const dirty =
    automation === null ||
    title.trim() !== automation.title ||
    prompt.trim() !== automation.prompt ||
    !sameTrigger(automation.trigger, trigger)

  function save(): void {
    if (!ready || !dirty) {
      return
    }

    const draft = { title: title.trim(), prompt: prompt.trim(), trigger }

    if (automation === null) {
      store.create(draft)
    } else {
      store.update(automation.id, draft)
    }

    onBack()
  }

  return (
    <section className="h-full overflow-y-auto bg-ground">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-divider bg-ground px-8 py-3">
        {/* 面包屑就是「你还在自动化里」这句话本身。左半边可点，回列表。 */}
        <nav aria-label="位置" className="flex items-center gap-1.5 text-xs">
          <button
            className="rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            onClick={onBack}
            type="button"
          >
            自动化
          </button>

          <span aria-hidden="true" className="text-muted-foreground">
            ›
          </span>

          <span className="max-w-xs truncate font-medium">{title.trim() || '未命名'}</span>
        </nav>

        <div className="flex items-center gap-2">
          {automation === null ? null : (
            <button
              className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              onClick={() => {
                store.remove(automation.id)
                onBack()
              }}
              type="button"
            >
              删除
            </button>
          )}

          <button
            className="rounded-md border border-divider bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-sidebar-accent disabled:opacity-40"
            disabled={!ready || !dirty}
            onClick={save}
            type="button"
          >
            保存
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-8 py-8">
        <input
          aria-label="名称"
          className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
          onChange={(event) => {
            setTitle(event.target.value)
          }}
          placeholder="未命名"
          value={title}
        />

        {automation === null ? (
          <p className="mt-3 text-xs text-muted-foreground">
            保存后开始按计划运行（手动触发除外）。
          </p>
        ) : (
          <div className="mt-3 flex items-center gap-3 text-xs">
            <button
              aria-checked={automation.enabled}
              className={cn(
                'relative h-4 w-7 rounded-full transition-colors',
                automation.enabled ? 'bg-foreground' : 'bg-divider',
              )}
              onClick={() => {
                store.setEnabled(automation.id, !automation.enabled)
              }}
              role="switch"
              type="button"
            >
              <span
                className={cn(
                  'absolute top-0.5 size-3 rounded-full bg-background transition-all',
                  automation.enabled ? 'left-3.5' : 'left-0.5',
                )}
              />
            </button>

            <span className="text-muted-foreground">
              {automation.enabled ? '已启用' : '已停用'}
            </span>

            {automation.nextRunAt === null ? null : (
              <span className="text-muted-foreground">
                下次 {describeMoment(automation.nextRunAt)}
              </span>
            )}
          </div>
        )}

        <div className="mt-6 flex gap-1 border-b border-divider">
          <Tab
            active={tab === 'settings'}
            label="设置"
            onClick={() => {
              setTab('settings')
            }}
          />
          <Tab
            active={tab === 'runs'}
            label="运行历史"
            onClick={() => {
              setTab('runs')
            }}
          />
        </div>

        {tab === 'runs' ? (
          <AutomationRunHistory runs={automation?.runs ?? []} />
        ) : (
          <div className="mt-6 space-y-6">
            <Section label="触发">
              <div className="flex items-center gap-2">
                <select
                  aria-label="触发方式"
                  className="rounded-md border border-divider bg-ground px-2 py-1.5 text-xs outline-none"
                  onChange={(event) => {
                    setKind(event.target.value as AutomationTrigger['kind'])
                  }}
                  value={kind}
                >
                  <option value="daily">每天</option>
                  <option value="interval">每隔一段时间</option>
                  <option value="manual">手动</option>
                </select>

                {kind === 'daily' ? (
                  <input
                    aria-label="每天几点跑"
                    className="rounded-md border border-divider bg-ground px-2 py-1.5 text-xs outline-none"
                    onChange={(event) => {
                      setAtTime(event.target.value)
                    }}
                    type="time"
                    value={atTime}
                  />
                ) : null}

                {kind === 'interval' ? (
                  <>
                    <input
                      aria-label="每隔多少分钟跑一次"
                      className="w-16 rounded-md border border-divider bg-ground px-2 py-1.5 text-xs outline-none"
                      min={5}
                      onChange={(event) => {
                        setEveryMinutes(Math.max(5, Number(event.target.value)))
                      }}
                      step={5}
                      type="number"
                      value={everyMinutes}
                    />

                    <span className="text-xs text-muted-foreground">分钟</span>
                  </>
                ) : null}
              </div>

              <p className="mt-2 text-xs text-muted-foreground">{describeTrigger(trigger)}</p>
            </Section>

            <Section label="指令">
              <textarea
                aria-label="指令"
                className="h-40 w-full resize-none bg-transparent text-xs leading-6 outline-none placeholder:text-muted-foreground/60"
                onChange={(event) => {
                  setPrompt(event.target.value)
                }}
                placeholder="到期时发给 AI 的那句话。写清楚要看什么、要产出什么。"
                value={prompt}
              />
            </Section>
          </div>
        )}
      </div>
    </section>
  )
}

function Tab({
  active,
  label,
  onClick,
}: {
  readonly active: boolean
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={cn(
        '-mb-px border-b-2 px-2.5 py-1.5 text-xs transition-colors',
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  )
}

function Section({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{label}</h3>

      <div className="rounded-lg border border-divider bg-background p-4">{children}</div>
    </div>
  )
}

/* "HH:mm" 与「一天里的第几分钟」之间只在这两处转换，别处一律用数字。 */

function toClock(atMinuteOfDay: number): string {
  const hours = Math.floor(atMinuteOfDay / 60)
  const minutes = atMinuteOfDay % 60

  return [hours, minutes].map((value) => value.toString().padStart(2, '0')).join(':')
}

function toMinuteOfDay(clock: string): number {
  const [hours = '0', minutes = '0'] = clock.split(':')

  return Number(hours) * 60 + Number(minutes)
}
