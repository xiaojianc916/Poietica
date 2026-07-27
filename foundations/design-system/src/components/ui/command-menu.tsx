import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { Search } from '@mynaui/icons-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface CommandMenuItem {
  readonly value: string
  readonly label: string
  readonly category?: string
  readonly shortcut?: string
  readonly leading?: ReactNode
}

export interface CommandMenuProps {
  readonly items: readonly CommandMenuItem[]
  readonly query: string
  readonly placeholder?: string
  readonly ariaLabel: string
  readonly emptyTitle?: string
  readonly emptyDescription?: string
  readonly onQueryChange: (query: string) => void
  readonly onSelect: (value: string) => void
}

/**
 * Accessible inline command selection pattern.
 *
 * Base UI owns:
 * - highlighted-item state
 * - list navigation
 * - Home and End behavior
 * - Enter selection
 * - active-descendant semantics
 * - input/listbox coordination
 *
 * Consumers own:
 * - command registration
 * - filtering policy
 * - execution
 * - business labels
 */
export function CommandMenu({
  items,
  query,
  placeholder = '输入命令名称…',
  ariaLabel,
  emptyTitle = '没有匹配的命令',
  emptyDescription = '尝试输入其他命令名称或分类。',
  onQueryChange,
  onSelect,
}: CommandMenuProps) {
  const itemValues = items.map((item) => item.value)

  const itemMap = new Map(items.map((item) => [item.value, item]))

  return (
    <BaseCombobox.Root<string>
      autoHighlight
      filter={null}
      inline
      inputValue={query}
      items={itemValues}
      itemToStringLabel={(value) => itemMap.get(value)?.label ?? value}
      onInputValueChange={(nextQuery) => {
        onQueryChange(nextQuery)
      }}
      onValueChange={(nextValue) => {
        if (nextValue !== null) {
          onSelect(nextValue)
        }
      }}
      open
      value={null}
    >
      <div className={cn('flex items-center gap-2', 'border-b border-divider', 'px-4')}>
        <Search aria-hidden="true" className={cn('size-4 shrink-0', 'text-muted-foreground')} />

        <BaseCombobox.Input
          aria-label={ariaLabel}
          autoFocus
          className={cn(
            'h-12 min-w-0 flex-1',
            'border-0 bg-transparent',
            'px-0 text-sm',
            'text-foreground',
            'outline-none shadow-none',
            'placeholder:text-muted-foreground',
          )}
          placeholder={placeholder}
        />

        <kbd
          className={cn(
            'rounded border',
            'border-divider',
            'bg-muted',
            'px-1.5 py-0.5',
            'text-[10px]',
            'text-muted-foreground',
          )}
        >
          Esc
        </kbd>
      </div>

      <BaseCombobox.List
        className={cn('max-h-80', 'overflow-y-auto', 'overscroll-contain', 'p-2 outline-none')}
      >
        {items.map((item) => (
          <BaseCombobox.Item
            className={cn(
              'flex min-h-11',
              'w-full items-center',
              'gap-3 rounded-md',
              'px-3 text-left',
              'text-sm outline-none',
              'cursor-default select-none',
              'data-[highlighted]:bg-accent',
              'data-[highlighted]:text-accent-foreground',
              'data-[disabled]:pointer-events-none',
              'data-[disabled]:opacity-50',
            )}
            key={item.value}
            value={item.value}
          >
            {item.leading ? (
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-4',
                  'shrink-0 place-items-center',
                  'text-muted-foreground',
                )}
              >
                {item.leading}
              </span>
            ) : null}

            <span className={cn('min-w-0 flex-1', 'truncate')}>{item.label}</span>

            {item.category ? (
              <span className={cn('shrink-0 text-xs', 'text-muted-foreground')}>
                {item.category}
              </span>
            ) : null}

            {item.shortcut ? (
              <kbd className={cn('shrink-0 text-xs', 'text-muted-foreground')}>{item.shortcut}</kbd>
            ) : null}
          </BaseCombobox.Item>
        ))}

        <BaseCombobox.Empty
          className={cn('grid min-h-32', 'place-content-center', 'gap-1 px-4', 'text-center')}
        >
          <span className={cn('text-sm font-medium', 'text-foreground')}>{emptyTitle}</span>

          <span className={cn('text-xs', 'text-muted-foreground')}>{emptyDescription}</span>
        </BaseCombobox.Empty>
      </BaseCombobox.List>
    </BaseCombobox.Root>
  )
}
