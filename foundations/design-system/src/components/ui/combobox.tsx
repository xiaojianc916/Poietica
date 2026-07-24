import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { Check, ChevronsUpDown, Search } from '@mynaui/icons-react'
import {
  type ComponentPropsWithoutRef,
  createContext,
  forwardRef,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '../../lib/utils'

export interface ComboboxOption {
  readonly value: string
  readonly label: string
}

interface ComboboxContextValue {
  readonly data: readonly ComboboxOption[]
  readonly type: string
  readonly value: string
  readonly width: number
  readonly setWidth: (width: number) => void
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
  const [width, setWidth] = useState(200)

  return (
    <ComboboxContext.Provider
      value={{
        data,
        type,
        value,
        width,
        setWidth,
      }}
    >
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
    </ComboboxContext.Provider>
  )
}

export type ComboboxTriggerProps = ComponentPropsWithoutRef<typeof BaseCombobox.Trigger>

export const ComboboxTrigger = forwardRef<HTMLButtonElement, ComboboxTriggerProps>(
  function ComboboxTrigger({ children, className, ...props }, forwardedRef) {
    const { data, type, value, setWidth } = useComboboxContext()
    const localRef = useRef<HTMLButtonElement | null>(null)

    useEffect(() => {
      const element = localRef.current

      if (!element) {
        return
      }

      const updateWidth = () => {
        if (element.offsetWidth > 0) {
          setWidth(element.offsetWidth)
        }
      }

      updateWidth()

      const resizeObserver = new ResizeObserver(updateWidth)
      resizeObserver.observe(element)

      return () => {
        resizeObserver.disconnect()
      }
    }, [setWidth])

    const selectedItem = data.find((item) => item.value === value)

    return (
      <BaseCombobox.Trigger
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2',
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
        ref={(element) => {
          localRef.current = element

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
            <span className="min-w-0 flex-1 truncate">{selectedItem?.label ?? `选择${type}…`}</span>

            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </>
        )}
      </BaseCombobox.Trigger>
    )
  },
)

export type ComboboxContentProps = ComponentPropsWithoutRef<typeof BaseCombobox.Popup>

export const ComboboxContent = forwardRef<HTMLDivElement, ComboboxContentProps>(
  function ComboboxContent({ className, style, ...props }, ref) {
    const { width } = useComboboxContext()

    return (
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner
          align="start"
          className="outline-none"
          sideOffset={4}
          style={{
            zIndex: 'calc(var(--ui-z-dialog) + 1)',
          }}
        >
          <BaseCombobox.Popup
            className={cn(
              'overflow-hidden rounded-md',
              'border border-divider',
              'bg-popover text-popover-foreground',
              'shadow-xl outline-none',
              'origin-[var(--transform-origin)]',
              'transition-[transform,scale,opacity]',
              'data-[ending-style]:scale-95',
              'data-[ending-style]:opacity-0',
              'data-[starting-style]:scale-95',
              'data-[starting-style]:opacity-0',
              className,
            )}
            ref={ref}
            style={{
              width,
              ...style,
            }}
            {...props}
          />
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    )
  },
)

export type ComboboxInputProps = ComponentPropsWithoutRef<typeof BaseCombobox.Input>

export const ComboboxInput = forwardRef<HTMLInputElement, ComboboxInputProps>(
  function ComboboxInput({ className, placeholder, ...props }, ref) {
    const { type } = useComboboxContext()

    return (
      <div className="flex items-center gap-2 border-b border-divider px-3">
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />

        <BaseCombobox.Input
          aria-label={props['aria-label'] ?? `搜索${type}`}
          className={cn(
            'h-10 min-w-0 flex-1',
            'bg-transparent text-sm text-foreground',
            'outline-none',
            'placeholder:text-muted-foreground',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          placeholder={placeholder ?? `搜索${type}…`}
          ref={ref}
          {...props}
        />
      </div>
    )
  },
)

export type ComboboxEmptyProps = ComponentPropsWithoutRef<typeof BaseCombobox.Empty>

export const ComboboxEmpty = forwardRef<HTMLDivElement, ComboboxEmptyProps>(function ComboboxEmpty(
  { children, className, ...props },
  ref,
) {
  const { type } = useComboboxContext()

  return (
    <BaseCombobox.Empty
      className={cn('px-3 py-6 text-center text-sm text-muted-foreground', className)}
      ref={ref}
      {...props}
    >
      {children ?? `没有找到匹配的${type}。`}
    </BaseCombobox.Empty>
  )
})

export type ComboboxListProps = ComponentPropsWithoutRef<typeof BaseCombobox.List>

export const ComboboxList = forwardRef<HTMLDivElement, ComboboxListProps>(function ComboboxList(
  { className, ...props },
  ref,
) {
  return (
    <BaseCombobox.List
      className={cn('max-h-64 overflow-y-auto overscroll-contain p-1', 'outline-none', className)}
      ref={ref}
      {...props}
    />
  )
})

export type ComboboxGroupProps = ComponentPropsWithoutRef<typeof BaseCombobox.Group>

export const ComboboxGroup = forwardRef<HTMLDivElement, ComboboxGroupProps>(function ComboboxGroup(
  { className, ...props },
  ref,
) {
  return <BaseCombobox.Group className={cn('grid gap-0.5', className)} ref={ref} {...props} />
})

export type ComboboxItemProps = Omit<
  ComponentPropsWithoutRef<typeof BaseCombobox.Item>,
  'value'
> & {
  readonly value: string
}

export const ComboboxItem = forwardRef<HTMLDivElement, ComboboxItemProps>(function ComboboxItem(
  { children, className, value, ...props },
  ref,
) {
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
      ref={ref}
      value={value}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>

      <BaseCombobox.ItemIndicator className="ml-auto shrink-0">
        <Check aria-hidden="true" className="size-4" />
      </BaseCombobox.ItemIndicator>
    </BaseCombobox.Item>
  )
})

export type ComboboxSeparatorProps = ComponentPropsWithoutRef<typeof BaseCombobox.Separator>

export const ComboboxSeparator = forwardRef<HTMLDivElement, ComboboxSeparatorProps>(
  function ComboboxSeparator({ className, ...props }, ref) {
    return (
      <BaseCombobox.Separator
        className={cn('-mx-1 my-1 h-px bg-divider', className)}
        ref={ref}
        {...props}
      />
    )
  },
)
