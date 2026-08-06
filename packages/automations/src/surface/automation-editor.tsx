import type { Automation, AutomationTrigger } from '@poietica/ipc'
import { ArrowLeftIcon, cn, PlayIcon } from '@poietica/ui'
import { type ReactNode, useState } from 'react'

import { sameSessionConfig, sameTrigger } from '../automation'
import type { AutomationStore } from '../automation-store'
import { AutomationRunHistory } from './automation-run-history'
import { AutomationSessionConfig } from './automation-session-config'

/*
 * 一条自动化的整页编辑器。
 *
 * 头部没有横线。那条 border-b 是全宽的，而正文是居中的 max-w-2xl —— 一条
 * 横线横穿整个窗口、下面的内容却只占中间一段，读起来是「这条线属于窗口」
 * 而不是「属于这一页」。Cursor 的同一处也没有。
 *
 * 页签是胶囊式分段控件，不是下划线。下划线暗示「这是一层导航」，而设置与
 * 运行历史是同一个对象的两个视图，分段控件才是它的语义。
 */

export interface AutomationEditorProps {
  readonly automation: Automation | null
  readonly onBack: () => void
  readonly store: AutomationStore
}

type EditorTab = 'settings' | 'runs'

const TABS: readonly { readonly id: EditorTab; readonly label: string }[] = [
  { id: 'settings', label: '设置' },
  { id: 'runs', label: '运行历史' },
]

function toClock(atMinuteOfDay: number): string {
  const pad = (value: number) => value.toString().padStart(2, '0')

  return `${pad(Math.floor(atMinuteOfDay / 60))}:${pad(atMinuteOfDay % 60)}`
}

function toMinuteOfDay(clock: string): number {
  const [hours = '0', minutes = '0'] = clock.split(':')

  return Number(hours) * 60 + Number(minutes)
}

/* 生成绑定给的是 Partial<Record<..>>，先把缺席的键滤掉再进状态。 */
function pickedFrom(automation: Automation | null): Record<string, string> {
  const picked: Record<string, string> = {}

  for (const [id, value] of Object.entries(automation?.sessionConfig ?? {})) {
    if (value !== undefined) {
      picked[id] = value
    }
  }

  return picked
}

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
  const [sessionConfig, setSessionConfig] = useState<Record<string, string>>(() =>
    pickedFrom(automation),
  )

  const trigger: AutomationTrigger =
    kind === 'manual'
      ? { kind: 'manual' }
      : kind === 'interval'
        ? { kind: 'interval', everyMinutes }
        : { kind: 'daily', atMinuteOfDay: toMinuteOfDay(atTime) }

  const ready = title.trim().length > 0 && prompt.trim().length > 0

  const dirty =
    automation === null ||
    title !== automation.title ||
    prompt !== automation.prompt ||
    !sameTrigger(automation.trigger, trigger) ||
    !sameSessionConfig(automation.sessionConfig, sessionConfig)

  function choose(controlId: string, value: string | null): void {
    setSessionConfig((current) => {
      const next = { ...current }

      if (value === null) {
        delete next[controlId]
      } else {
        next[controlId] = value
      }

      return next
    })
  }

  function save(): void {
    const draft = { prompt: prompt.trim(), sessionConfig, title: title.trim(), trigger }

    if (automation === null) {
      store.create(draft)
    } else {
      store.update(automation.id, draft)
    }

    onBack()
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-ground">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-ground px-8 py-3">
        <IconButton label="返回自动化列表" onClick={onBack}>
          <ArrowLeftIcon className="size-4" />
        </IconButton>

        <div className="flex items-center gap-1">
          {/*
            草稿没有 id，runNow 无从点名，所以按钮禁用而不是假装能跑。
            标题直说原因 —— 一颗不说明理由的灰按钮是死路。
          */}
          <IconButton
            disabled={automation === null}
            label={automation === null ? '先保存才能试运行' : '试运行'}
            onClick={() => {
              if (automation !== null) {
                store.runNow(automation.id)
              }
            }}
          >
            <PlayIcon className="size-4" />
          </IconButton>

          {automation === null ? null : (
            <button
              className="rounded-md px-2.5 py-1.5 text-xs text-destructive transition-colors hover:bg-sidebar-accent"
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
            className="rounded-md bg-foreground px-3 py-1.5 text-xs text-ground transition-opacity disabled:pointer-events-none disabled:opacity-40"
            disabled={!ready || !dirty}
            onClick={save}
            type="button"
          >
            保存
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl px-8 pb-16">
        <input
          className="w-full bg-transparent text-2xl text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="未命名"
          value={title}
        />

        <div className="mt-6 flex gap-1">
          {TABS.map((entry) => (
            <button
              aria-current={tab === entry.id ? 'page' : undefined}
              className={cn(
                'rounded-full px-3 py-1 text-xs transition-colors',
                tab === entry.id
                  ? 'bg-sidebar-accent text-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
              )}
              key={entry.id}
              onClick={() => setTab(entry.id)}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === 'runs' ? (
          <div className="mt-6">
            <AutomationRunHistory runs={automation?.runs ?? []} />
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            <Section label="触发">
              <div className="flex flex-wrap items-center gap-2">
                {(['manual', 'interval', 'daily'] as const).map((option) => (
                  <button
                    className={cn(
                      'rounded-full px-3 py-1 text-xs transition-colors',
                      kind === option
                        ? 'bg-sidebar-accent text-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                    )}
                    key={option}
                    onClick={() => setKind(option)}
                    type="button"
                  >
                    {option === 'manual' ? '手动' : option === 'interval' ? '按间隔' : '每天'}
                  </button>
                ))}

                {kind === 'interval' ? (
                  <input
                    className="w-20 rounded-md bg-background px-2 py-1 text-xs text-foreground outline-none"
                    min={1}
                    onChange={(event) => setEveryMinutes(Math.max(1, Number(event.target.value)))}
                    type="number"
                    value={everyMinutes}
                  />
                ) : null}

                {kind === 'daily' ? (
                  <input
                    className="rounded-md bg-background px-2 py-1 text-xs text-foreground outline-none"
                    onChange={(event) => setAtTime(event.target.value)}
                    type="time"
                    value={atTime}
                  />
                ) : null}
              </div>
            </Section>

            <Section label="会话">
              <AutomationSessionConfig onChange={choose} value={sessionConfig} />
            </Section>

            <Section label="指令">
              <textarea
                className="min-h-40 w-full resize-y rounded-md bg-background p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="到期时发给 agent 的那句话"
                value={prompt}
              />
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}

function IconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  readonly children: ReactNode
  readonly disabled?: boolean
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

function Section({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    <section className="rounded-lg border border-divider/60 p-4">
      <h2 className="mb-3 text-xs text-muted-foreground">{label}</h2>
      {children}
    </section>
  )
}
