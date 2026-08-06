import { useMemo, useState, useSyncExternalStore } from 'react'

import { summarize } from '../automation'
import type { AutomationStore } from '../automation-store'
import { AutomationComposer } from './automation-composer'
import { AutomationList } from './automation-list'
import { TemplateGallery } from './template-gallery'

/**
 * 自动化表面。
 *
 * 版式取自行业里同类页面的信息架构：页头 + 统计牌 + 列表 + 模板画廊。没有取的
 * 是 Author 与 Team 两列 —— 那两列在云端多人产品里承载真实信息，在一个本地
 * 单用户应用里只会是两列恒定值。空出来的位置留给这里真正需要的：触发条件，
 * 以及最近一次运行。
 *
 * 这一层只做编排。它自己持有的状态只有一个 composing（表单开没开），因为那是
 * 页头那颗按钮和表单之间的事，别人管不着；表单字段归 AutomationComposer，
 * 模板分类归 TemplateGallery —— 状态跟着用它的人走，切一下模板分类不该惊动
 * 统计牌和表格。
 */

export interface AutomationsSurfaceProps {
  readonly store: AutomationStore
}

export function AutomationsSurface({ store }: AutomationsSurfaceProps) {
  const { automations, loaded } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )

  const [composing, setComposing] = useState(false)

  const summary = useMemo(() => summarize(automations), [automations])

  return (
    <section className="h-full overflow-y-auto bg-ground">
      <header className="px-8 pb-6 pt-8">
        <h1 className="text-lg font-semibold tracking-tight">自动化</h1>

        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
          让重复的活儿按计划自己跑。每一次运行都会开出一条对话，做了什么、说了什么，
          都留在那条对话里。
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
          <AutomationComposer
            onSubmit={(draft) => {
              store.create(draft)
              setComposing(false)
            }}
          />
        ) : null}

        <AutomationList automations={automations} loaded={loaded} store={store} />
      </div>

      <TemplateGallery
        onAdd={(draft) => {
          store.create(draft)
        }}
      />
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
