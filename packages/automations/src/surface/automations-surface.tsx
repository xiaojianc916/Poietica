import type { Automation, AutomationTrigger } from '@poietica/ipc'
import { cn } from '@poietica/ui'
import type { ReactNode } from 'react'
import { useMemo, useState, useSyncExternalStore } from 'react'

import { describeMoment, describeTrigger, latestRun, summarize } from '../automation'
import type { AutomationStore } from '../automation-store'
import { AUTOMATION_CATEGORIES, AUTOMATION_TEMPLATES, type AutomationCategory } from '../templates'

/**
 * 自动化表面。
 *
 * 版式取自行业里同类页面的信息架构：页头 + 统计牌 + 列表 + 模板画廊。没有取的
 * 是 Author 与 Team 两列 —— 那两列在云端多人产品里承载真实信息，在一个本地
 * 单用户应用里只会是两列恒定值。空出来的位置留给这里真正需要的：触发条件，
 * 以及最近一次运行。
 */

export interface AutomationsSurfaceProps {
  readonly store: AutomationStore
}

const ALL_CATEGORIES = '全部' as const

type CategoryTab = typeof ALL_CATEGORIES | AutomationCategory

export function AutomationsSurface({ store }: AutomationsSurfaceProps) {
  const { automations, loaded } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )

  const [composing, setComposing] = useState(false)
  const [category, setCategory] = useState<CategoryTab>(ALL_CATEGORIES)

  const summary = useMemo(() => summarize(automations), [automations])

  const templates = AUTOMATION_TEMPLATES.filter(
    (template) => category === ALL_CATEGORIES || template.category === category,
  )

  return (
    <section className="h-full overflow-y-auto bg-ground">
      <header className="px-8 pb-6 pt-8">
        <h1 className="text-lg font-semibold tracking-tight">自动化</h1>

        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
          依托全天候在线的代理，响应环境触发事件，自动执行重复性工作
        </p>

        <dl className="mt-6 grid grid-cols-3 gap-3">
          <Tile label="自动化" value={summary.total} />
          <Tile label="成功 · 7 天" value={summary.succeeded} />
          <Tile label="失败 · 7 天" value={summary.failed} />
        </dl>
      </header>

      <div className="px-8">
        <div className="flex items-center justify-between border-b border-divider pb-3">
          <h2 className="text-xs font-medium text-muted-foreground">我的自动化</h2>

          <button
            className="rounded-md border border-divider bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-sidebar-accent"
            onClick={() => {
              setComposing((open) => !open)
            }}
            type="button"
          >
            {composing ? '取消' : '新建自动化'}
          </button>
        </div>

        {composing ? (
          <Composer
            onSubmit={(draft) => {
              store.create(draft)
              setComposing(false)
            }}
          />
        ) : null}

        {loaded && automations.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            还没有自动化。从下面的模板开始，或者新建一个
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-divider">
                <th className="w-[38%] py-2 font-medium">自动化</th>
                <th className="w-[14%] py-2 font-medium">状态</th>
                <th className="w-[16%] py-2 font-medium">触发</th>
                <th className="w-[16%] py-2 font-medium">最近运行</th>
                <th className="w-[16%] py-2 text-right font-medium">操作</th>
              </tr>
            </thead>

            <tbody>
              {automations.map((automation) => (
                <Row automation={automation} key={automation.id} store={store} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-10 border-t border-divider px-8 py-6">
        <h2 className="text-xs font-medium text-muted-foreground">从模板开始</h2>

        <div className="mt-3 flex gap-1">
          {[ALL_CATEGORIES, ...AUTOMATION_CATEGORIES].map((tab) => (
            <button
              className={cn(
                'rounded-md px-2.5 py-1 text-xs transition-colors hover:bg-sidebar-accent',
                tab === category ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground',
              )}
              key={tab}
              onClick={() => {
                setCategory(tab)
              }}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>

        <ul className="mt-4 grid grid-cols-2 gap-3">
          {templates.map((template) => (
            <li className="rounded-lg border border-divider bg-background p-4" key={template.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium">{template.title}</p>

                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {template.description}
                  </p>

                  <p className="mt-2 text-xs text-muted-foreground">
                    {describeTrigger(template.trigger)}
                  </p>
                </div>

                <button
                  className="shrink-0 rounded-md border border-divider px-2.5 py-1 text-xs transition-colors hover:bg-sidebar-accent"
                  onClick={() => {
                    store.create({
                      title: template.title,
                      prompt: template.prompt,
                      trigger: template.trigger,
                    })
                  }}
                  type="button"
                >
                  添加
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Tile({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="rounded-lg border border-divider bg-background px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function Row({
  automation,
  store,
}: {
  readonly automation: Automation
  readonly store: AutomationStore
}) {
  const run = latestRun(automation)

  return (
    <tr className="border-b border-divider/60">
      <td className="py-2.5 pr-4">
        <p className="truncate font-medium">{automation.title}</p>
        <p className="truncate text-muted-foreground">{automation.prompt}</p>
      </td>

      <td className="py-2.5 text-muted-foreground">{automation.enabled ? '启用' : '停用'}</td>

      <td className="py-2.5 text-muted-foreground">{describeTrigger(automation.trigger)}</td>

      <td className="py-2.5 text-muted-foreground">
        {run === null
          ? '未运行'
          : `${run.outcome === 'succeeded' ? '成功' : '失败'} · ${describeMoment(run.startedAt)}`}
      </td>

      <td className="py-2.5 text-right">
        <RowAction
          label="运行"
          onClick={() => {
            store.runNow(automation.id)
          }}
        />
        <RowAction
          label={automation.enabled ? '停用' : '启用'}
          onClick={() => {
            store.setEnabled(automation.id, !automation.enabled)
          }}
        />
        <RowAction
          label="删除"
          onClick={() => {
            store.remove(automation.id)
          }}
        />
      </td>
    </tr>
  )
}

function RowAction({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      className="ml-2 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  )
}

interface ComposerProps {
  readonly onSubmit: (draft: {
    readonly title: string
    readonly prompt: string
    readonly trigger: AutomationTrigger
  }) => void
}

/*
 * 三个字段，所以是一块就地展开的面板，不是模态框。
 *
 * 模态框的代价是「打断」，它换来的是「必须先处理完」—— 新建一条自动化没有这个
 * 必要性，人应该能一边看着已有的几条一边写。
 */
function Composer({ onSubmit }: ComposerProps) {
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
 * 此前它包着 {children}：屏幕阅读器和 biome 都看不出里面有没有输入框 ——
 * 这不是误报，点标题不聚焦、朗读时读不出字段名，都是真的。htmlFor 把这层
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
