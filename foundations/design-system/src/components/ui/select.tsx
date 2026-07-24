import { Select as BaseSelect } from '@base-ui/react/select'
import { Check, ChevronsUpDown } from '@mynaui/icons-react'
import {
  type ComponentPropsWithoutRef,
  createContext,
  forwardRef,
  type ReactNode,
  useContext,
  useState,
} from 'react'
import { cn } from '../../lib/utils'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

interface SelectContextValue {
  readonly data: readonly SelectOption[]
  readonly type: string
  readonly value: string
  readonly width: number
  readonly setWidth: (width: number) => void
}

const SelectContext = createContext<SelectContextValue | null>(null)

function useSelectContext(): SelectContextValue {
  const context = useContext(SelectContext)

  if (!context) {
    throw new Error('Select components must be rendered inside <Select>.')
  }

  return context
}

export interface SelectProps {
  readonly children: ReactNode
  readonly data: readonly SelectOption[]
  readonly type: string
  readonly value: string
  readonly open?: boolean
  readonly defaultOpen?: boolean
  readonly disabled?: boolean
  readonly onValueChange: (value: string) => void
  readonly onOpenChange?: (open: boolean) => void
}

/**
 * Select is intended for finite,
 * non-searchable option sets.
 *
 * Use Combobox when the option set is large
 * enough to require filtering.
 */
export function Select({
  children,
  data,
  type,
  value,
  open,
  defaultOpen,
  disabled = false,
  onValueChange,
  onOpenChange,
}: SelectProps) {
  const [width, setWidth] = useState(200)

  return (
    <SelectContext.Provider
      value={{
        data,
        type,
        value,
        width,
        setWidth,
      }}
    >
      <BaseSelect.Root<string>
        defaultOpen={defaultOpen}
        disabled={disabled}
        onOpenChange={(nextOpen) => {
          onOpenChange?.(nextOpen)
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
      </BaseSelect.Root>
    </SelectContext.Provider>
  )
}

export type SelectTriggerProps = ComponentPropsWithoutRef<typeof BaseSelect.Trigger>

export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  function SelectTrigger({ children, className, ...props }, forwardedRef) {
    const { data, type, value, setWidth } = useSelectContext()
    const selectedItem = data.find((item) => item.value === value)

    return (
      <BaseSelect.Trigger
        className={cn(
          'flex h-[var(--ui-control-height-lg)] w-full',
          'items-center justify-between gap-2',
          'rounded-md border border-input',
          'bg-background px-3',
          'text-left text-sm text-foreground',
          'shadow-sm outline-none',
          'transition-[border-color,box-shadow,background-color]',
          'hover:bg-muted/40',
          'focus-visible:ring-2',
          'focus-visible:ring-ring',
          'data-[popup-open]:border-ring',
          'disabled:cursor-not-allowed',
          'disabled:opacity-50',
          className,
        )}
        ref={(element) => {
          if (element && element.offsetWidth > 0) {
            setWidth(element.offsetWidth)
          }

          if (typeof forwardedRef === 'function') {
            forwardedRef(element)
          } else if (forwardedRef) {
            forwardedRef.current = element
          }
        }}
        type="button"
        {...props}
      >
        {children ?? (
          <>
            <span className={cn('min-w-0 flex-1', 'truncate')}>
              {selectedItem?.label ?? `选择${type}…`}
            </span>

            <BaseSelect.Icon>
              <ChevronsUpDown
                aria-hidden="true"
                className={cn('size-4 shrink-0', 'text-muted-foreground')}
              />
            </BaseSelect.Icon>
          </>
        )}
      </BaseSelect.Trigger>
    )
  },
)

export type SelectContentProps = ComponentPropsWithoutRef<typeof BaseSelect.Popup>

export const SelectContent = forwardRef<HTMLDivElement, SelectContentProps>(function SelectContent(
  { className, style, ...props },
  ref,
) {
  const { width } = useSelectContext()

  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        align="start"
        alignItemWithTrigger={false}
        className={cn('z-[calc(var(--ui-z-dialog)+1)]', 'outline-none')}
        sideOffset={4}
      >
        <BaseSelect.Popup
          className={cn(
            'overflow-hidden',
            'rounded-md border',
            'border-divider',
            'bg-popover',
            'text-popover-foreground',
            'shadow-xl outline-none',
            'origin-[var(--transform-origin)]',
            'transition-[transform,scale,opacity]',
            'duration-[var(--ui-duration-fast)]',
            'ease-[var(--ui-ease-standard)]',
            'data-[starting-style]:scale-95',
            'data-[starting-style]:opacity-0',
            'data-[ending-style]:scale-95',
            'data-[ending-style]:opacity-0',
            className,
          )}
          ref={ref}
          style={{
            width,
            ...style,
          }}
          {...props}
        />
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  )
})

export type SelectListProps = ComponentPropsWithoutRef<typeof BaseSelect.List>

export const SelectList = forwardRef<HTMLDivElement, SelectListProps>(function SelectList(
  { className, ...props },
  ref,
) {
  return (
    <BaseSelect.List
      className={cn(
        'max-h-64',
        'overflow-y-auto',
        'overscroll-contain',
        'p-1 outline-none',
        className,
      )}
      ref={ref}
      {...props}
    />
  )
})

export type SelectGroupProps = ComponentPropsWithoutRef<typeof BaseSelect.Group>

export const SelectGroup = forwardRef<HTMLDivElement, SelectGroupProps>(function SelectGroup(
  { className, ...props },
  ref,
) {
  return <BaseSelect.Group className={cn('grid gap-0.5', className)} ref={ref} {...props} />
})

export type SelectItemProps = Omit<ComponentPropsWithoutRef<typeof BaseSelect.Item>, 'value'> & {
  readonly value: string
}

export const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(function SelectItem(
  { children, className, value, ...props },
  ref,
) {
  return (
    <BaseSelect.Item
      className={cn(
        'group relative flex',
        'min-h-9',
        'cursor-default select-none',
        'items-center gap-2',
        'rounded-sm px-2 py-1.5',
        'text-sm outline-none',
        'transition-colors',
        'data-[highlighted]:bg-accent',
        'data-[highlighted]:text-accent-foreground',
        'data-[disabled]:pointer-events-none',
        'data-[disabled]:opacity-50',
        className,
      )}
      ref={ref}
      value={value}
      {...props}
    >
      <BaseSelect.ItemText className={cn('min-w-0 flex-1', 'truncate')}>
        {children}
      </BaseSelect.ItemText>

      <BaseSelect.ItemIndicator className="ml-auto shrink-0">
        <Check aria-hidden="true" className="size-4" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  )
})

export type SelectSeparatorProps = ComponentPropsWithoutRef<typeof BaseSelect.Separator>

export const SelectSeparator = forwardRef<HTMLDivElement, SelectSeparatorProps>(
  function SelectSeparator({ className, ...props }, ref) {
    return (
      <BaseSelect.Separator
        className={cn('-mx-1 my-1 h-px', 'bg-divider', className)}
        ref={ref}
        {...props}
      />
    )
  },
)
