import { cn } from '@poietica/ui'
import { useState } from 'react'

import { describeTrigger } from '../automation'
import type { AutomationDraft } from '../automation-store'
import { AUTOMATION_CATEGORIES, AUTOMATION_TEMPLATES, type AutomationCategory } from '../templates'

/**
 * 从模板开始。
 *
 * category 住在这里，不住在页面组件里：它只影响下面这排卡片，放在上一层就意味着
 * 切一下分类，统计牌和整张表格陪着重渲染一次 —— 状态该跟着用它的人走。
 *
 * 只收 onAdd 而不是整个 store：这一块要做的事就一件，多给的每一个能力都是
 * 以后可能被顺手用掉的口子。
 */

export interface TemplateGalleryProps {
  readonly onAdd: (draft: AutomationDraft) => void
}

const ALL_CATEGORIES = '全部' as const

type CategoryTab = typeof ALL_CATEGORIES | AutomationCategory

export function TemplateGallery({ onAdd }: TemplateGalleryProps) {
  const [category, setCategory] = useState<CategoryTab>(ALL_CATEGORIES)

  const templates = AUTOMATION_TEMPLATES.filter(
    (template) => category === ALL_CATEGORIES || template.category === category,
  )

  return (
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
                  onAdd({
                    title: template.title,
                    prompt: template.prompt,
                    trigger: template.trigger,

                    /*
                     * 模板对模型没有意见。空表不是「还没填」，它是一个明确的
                     * 取值：不改动这条对话的会话设置，用 agent 当下的默认跑。
                     * 想把组合固定下来，打开编辑器保存一次即可 —— 那时界面上
                     * 显示的三颗胶囊会被原样存进去。
                     */
                    sessionConfig: {},
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
  )
}
