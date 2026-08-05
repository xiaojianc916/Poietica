import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { Check, ChevronsUpDown, Search } from '@mynaui/icons-react'
import { type ComponentProps, createContext, type ReactNode, useContext, useMemo } from 'react'
import { cn } from '../../lib/utils'
import { popupPositionerClassName, popupSurfaceClassName } from './popup-surface'

export interface ComboboxOption {
  readonly value: string
  readonly label: string
}

interface ComboboxContextValue {
  readonly data: readonly ComboboxOption[]
  readonly type: string
  readonly value: string
}

const ComboboxContext = createContext<ComboboxContextValue | null>(null)

function useComboboxContext(): ComboboxContextValue {
  const context = useContext(ComboboxContext)

  if (!context) {
    throw new Error('Combobox components must be rendered inside <Combobox>.')
  }

  return context
}

export interface ComboboxProps {
  readonly children: ReactNode
  readonly data: readonly ComboboxOption[]
  readonly type: string
  readonly value: string
  readonly open: boolean
  readonly disabled?: boolean
  readonly onValueChange: (value: string) => void
  readonly onOpenChange: (open: boolean) => void
}

export function Combobox({
  children,
  data,
  type,
  value,
  open,
  disabled = false,
  onValueChange,
  onOpenChange,
}: ComboboxProps) {
  /* 与 select.tsx 同一条理由：provider 的值换身份，下游全部重画。 */
  const selection = useMemo<ComboboxContextValue>(
    () => ({ data, type, value }),
    [data, type, value],
  )

  return (
    <ComboboxContext value={selection}>
      <BaseCombobox.Root<string>
        disabled={disabled}
        onOpenChange={(nextOpen) => {
          onOpenChange(nextOpen)
        }}
        onValueChange={(nextValue) => {
          if (nextValue !== null) {
            onValueChange(nextValue)
          }
        }}
        open={open}
        value={value || null}
      >
        {children}
      </BaseCombobox.Root>
    </ComboboxContext>
  )
}

export type ComboboxTriggerProps = ComponentProps<typeof BaseCombobox.Trigger>

export function ComboboxTrigger({ children, className, ...props }: ComboboxTriggerProps) {
  const { data, type, value } = useComboboxContext()

  const selectedItem = data.find((item) => item.value === value)

  return (
    <BaseCombobox.Trigger
      className={cn(
        'flex h-[var(--ui-control-height-lg)] w-full items-center justify-between gap-2',
        'rounded-md border border-input',
        'bg-background px-3 text-left text-sm text-foreground',
        'shadow-sm outline-none',
        'transition-[border-color,box-shadow,background-color]',
        'hover:bg-muted/40',
        'focus-visible:ring-2 focus-visible:ring-ring',
        'data-[popup-open]:border-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      type="button"
      {...props}
    >
      {children ?? (
        <>
          <span className="min-w-0 flex-1 truncate">{selectedItem?.label ?? `选择${type}…`}</span>

          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </>
      )}
    </BaseCombobox.Trigger>
  )
}

export type ComboboxContentProps = ComponentProps<typeof BaseCombobox.Popup>

export function ComboboxContent({ className, style, ...props }: ComboboxContentProps) {
  return (
    <BaseCombobox.Portal>
      <BaseCombobox.Positioner align="start" className={popupPositionerClassName} sideOffset={4}>
        <BaseCombobox.Popup
          className={cn(popupSurfaceClassName, 'shadow-[var(--ui-shadow-lg)]', className)}
          style={{ inlineSize: 'var(--anchor-width)', ...style }}
          {...props}
        />
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  )
}

export type ComboboxInputProps = ComponentProps<typeof BaseCombobox.Input>

export function ComboboxInput({ className, placeholder, ...props }: ComboboxInputProps) {
  const { type } = useComboboxContext()

  return (
    <div className="flex items-center gap-2 border-b border-divider px-3">
      <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />

      <BaseCombobox.Input
        aria-label={props['aria-label'] ?? `搜索${type}`}
        className={cn(
          'h-[var(--ui-control-height-lg)] min-w-0 flex-1',
          'bg-transparent text-sm text-foreground',
          'outline-none',
          'placeholder:text-muted-foreground',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        placeholder={placeholder ?? `搜索${type}…`}
        {...props}
      />
    </div>
  )
}

export type ComboboxEmptyProps = ComponentProps<typeof BaseCombobox.Empty>

export function ComboboxEmpty({ children, className, ...props }: ComboboxEmptyProps) {
  const { type } = useComboboxContext()

  return (
    <BaseCombobox.Empty
      className={cn('px-3 py-6 text-center text-sm text-muted-foreground', className)}
      {...props}
    >
      {children ?? `没有找到匹配的${type}。`}
    </BaseCombobox.Empty>
  )
}

export type ComboboxListProps = ComponentProps<typeof BaseCombobox.List>

export function ComboboxList({ className, ...props }: ComboboxListProps) {
  return (
    <BaseCombobox.List
      className={cn('max-h-64 overflow-y-auto overscroll-contain p-1', 'outline-none', className)}
      {...props}
    />
  )
}

export type ComboboxGroupProps = ComponentProps<typeof BaseCombobox.Group>

export function ComboboxGroup({ className, ...props }: ComboboxGroupProps) {
  return <BaseCombobox.Group className={cn('grid gap-0.5', className)} {...props} />
}

export type ComboboxItemProps = Omit<ComponentProps<typeof BaseCombobox.Item>, 'value'> & {
  readonly value: string
}

export function ComboboxItem({ children, className, value, ...props }: ComboboxItemProps) {
  return (
    <BaseCombobox.Item
      className={cn(
        'group relative flex min-h-9',
        'cursor-default select-none items-center gap-2',
        'rounded-sm px-2 py-1.5 text-sm',
        'outline-none transition-colors',
        'data-[highlighted]:bg-accent',
        'data-[highlighted]:text-accent-foreground',
        'data-[disabled]:pointer-events-none',
        'data-[disabled]:opacity-50',
        className,
      )}
      value={value}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>

      <BaseCombobox.ItemIndicator className="ml-auto shrink-0">
        <Check aria-hidden="true" className="size-4" />
      </BaseCombobox.ItemIndicator>
    </BaseCombobox.Item>
  )
}

export type ComboboxSeparatorProps = ComponentProps<typeof BaseCombobox.Separator>

export function ComboboxSeparator({ className, ...props }: ComboboxSeparatorProps) {
  return (
    <BaseCombobox.Separator className={cn('-mx-1 my-1 h-px bg-divider', className)} {...props} />
  )
}
