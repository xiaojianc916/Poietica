import type { AutomationTrigger } from '@poietica/ipc'
import type { ReactNode } from 'react'
import { useState } from 'react'

import type { AutomationDraft } from '../automation-store'

/**
 * 新建一条自动化。
 *
 * 三个字段，所以是一块就地展开的面板，不是模态框。模态框的代价是「打断」，
 * 它换来的是「必须先处理完」—— 新建一条自动化没有这个必要性，人应该能一边
 * 看着已有的几条一边写。
 *
 * 表单的五个字段全部住在这里，页面那一层看不见它们：人每敲一个字，重渲染的
 * 范围就是这块面板。
 */

export interface AutomationComposerProps {
  /* 就是 store.create 的入参类型本身，不在这里手抄一份结构。 */
  readonly onSubmit: (draft: AutomationDraft) => void
}

export function AutomationComposer({ onSubmit }: AutomationComposerProps) {
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<AutomationTrigger['kind']>('daily')
  const [everyMinutes, setEveryMinutes] = useState(60)
  const [atTime, setAtTime] = useState('09:00')

  const ready = title.trim().length > 0 && prompt.trim().length > 0

  /*
   * 表单三个字段收束成一个触发条件。
   *
   * time 控件给出的是 "HH:mm"，落进领域时立刻变成「一天里的第几分钟」这个
   * 单一数字 —— 字符串留到领域里，此后每一处比较都得先解析一次，而每一次
   * 解析都是一个可能失败的地方。
   */
  function buildTrigger(): AutomationTrigger {
    if (kind === 'manual') {
      return { kind: 'manual' }
    }

    if (kind === 'interval') {
      return { kind: 'interval', everyMinutes }
    }

    const [hours = '0', minutes = '0'] = atTime.split(':')

    return { kind: 'daily', atMinuteOfDay: Number(hours) * 60 + Number(minutes) }
  }

  return (
    <form
      className="mt-4 space-y-3 rounded-lg border border-divider bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault()

        if (!ready) {
          return
        }

        onSubmit({ title: title.trim(), prompt: prompt.trim(), trigger: buildTrigger() })
      }}
    >
      <Field htmlFor="automation-title" label="名称">
        <input
          className="w-full rounded-md border border-divider bg-ground px-2.5 py-1.5 text-xs outline-none focus:border-foreground/30"
          id="automation-title"
          onChange={(event) => {
            setTitle(event.target.value)
          }}
          placeholder="每天早上找一遍关键缺陷"
          value={title}
        />
      </Field>

      <Field htmlFor="automation-prompt" label="要做什么">
        <textarea
          className="h-20 w-full resize-none rounded-md border border-divider bg-ground px-2.5 py-1.5 text-xs outline-none focus:border-foreground/30"
          id="automation-prompt"
          onChange={(event) => {
            setPrompt(event.target.value)
          }}
          placeholder="到期时发给 AI 的那句话。写清楚要看什么、要产出什么。"
          value={prompt}
        />
      </Field>

      <Field htmlFor="automation-trigger" label="什么时候跑">
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-divider bg-ground px-2 py-1.5 text-xs outline-none"
            id="automation-trigger"
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
      </Field>

      <div className="flex justify-end">
        <button
          className="rounded-md border border-divider bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-sidebar-accent disabled:opacity-40"
          disabled={!ready}
          type="submit"
        >
          创建
        </button>
      </div>
    </form>
  )
}

/*
 * label 必须真的指向一个控件。
 *
 * 包着 {children} 的写法，屏幕阅读器和静态检查都看不出里面有没有输入框 ——
 * 那不是误报：点标题不聚焦、朗读时读不出字段名，都是真的。htmlFor 把这层
 * 关系写明，控件那边给出同名 id。
 */
function Field({
  children,
  htmlFor,
  label,
}: {
  readonly children: ReactNode
  readonly htmlFor: string
  readonly label: string
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted-foreground" htmlFor={htmlFor}>
        {label}
      </label>

      {children}
    </div>
  )
}
