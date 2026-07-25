import { Globe, Plus, Search } from '@mynaui/icons-react'
import type { ComponentType } from 'react'

interface QuickAction {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly icon: ComponentType<{ readonly className?: string }>
  readonly prompt: string
}

const ACTIONS: readonly QuickAction[] = [
  { id: 'create', title: '创建', description: '图形、图片、文档', icon: Plus, prompt: '帮我创建' },
  { id: 'find', title: '查找', description: '答案与文件', icon: Search, prompt: '帮我查找' },
  { id: 'research', title: '研究', description: '应用与网页', icon: Globe, prompt: '帮我研究' },
]

export function AssistantQuickActions({ onPick }: { readonly onPick: (prompt: string) => void }) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-3">
      {ACTIONS.map(({ id, title, description, icon: Icon, prompt }) => (
        <button
          className="rounded-[14px] border border-divider bg-background px-4 pb-4 pt-3.5 text-left transition-colors hover:bg-muted/30"
          key={id}
          onClick={() => onPick(prompt)}
          type="button"
        >
          <Icon className="size-[18px] text-muted-foreground" />
          <p className="mt-6 text-[15px] font-medium tracking-[-0.01em]">{title}</p>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{description}</p>
        </button>
      ))}
    </div>
  )
}
