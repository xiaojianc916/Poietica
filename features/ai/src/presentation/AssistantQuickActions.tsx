import type { ComponentType } from 'react'

import { GlobeIcon, PlusIcon, SearchIcon } from './primitives/icons'

interface QuickAction {
  readonly id: string
  readonly icon: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: 'true' }>
  readonly title: string
  readonly subtitle: string
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: 'create', icon: PlusIcon, title: '创建', subtitle: '图形、图片、文档' },
  { id: 'find', icon: SearchIcon, title: '查找', subtitle: '答案与文件' },
  { id: 'research', icon: GlobeIcon, title: '研究', subtitle: '应用与网页' },
]

export function AssistantQuickActions({
  onSelect,
}: {
  readonly onSelect: (actionId: string) => void
}) {
  return (
    <div className="assistant-quick-actions">
      {QUICK_ACTIONS.map(({ id, icon: Icon, title, subtitle }) => (
        <button
          className="assistant-tile"
          key={id}
          onClick={() => {
            onSelect(id)
          }}
          type="button"
        >
          <Icon aria-hidden="true" className="assistant-tile__icon" />

          <span className="assistant-tile__title">{title}</span>

          <span className="assistant-tile__subtitle">{subtitle}</span>
        </button>
      ))}
    </div>
  )
}
