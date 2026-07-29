import { Select as BaseSelect } from '@base-ui/react/select'
import { Check, ChevronsUpDown } from '@mynaui/icons-react'
import {
  type ComponentPropsWithoutRef,
  createContext,
  forwardRef,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react'
import { cn } from '../../lib/utils'
import { popupPositionerClassName, popupSurfaceClassName } from './popup-surface'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

interface SelectContextValue {
  readonly data: readonly SelectOption[]
  readonly type: string
  readonly value: string
  readonly size: SelectTriggerSize
  readonly setSize: (size: SelectTriggerSize) => void
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
  /* 触发器与选项行必须同档，尺寸只有 SelectTrigger 的 size 一个来源。 */
  const [size, setSize] = useState<SelectTriggerSize>('md')

  return (
    <SelectContext.Provider
      value={{
        data,
        type,
        value,
        size,
        setSize,
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

export type SelectTriggerSize = 'sm' | 'md'

export type SelectTriggerTone = 'outline' | 'plain'

export type SelectTriggerProps = ComponentPropsWithoutRef<typeof BaseSelect.Trigger> & {
  /** sm 用于设置页这类密集列表，md 为默认尺寸。 */
  readonly size?: SelectTriggerSize
  /** plain 去掉边框与阴影，背景透明因此与所在卡片同色。 */
  readonly tone?: SelectTriggerTone
}

/*
 * 高度、内距、字号与图标尺寸必须一起换档，否则文字会顶到箭头上。
 * 尺寸只有这几张表，使用方通过 size / tone 选择，不通过样式覆盖。
 */
const TRIGGER_SIZE: Record<SelectTriggerSize, string> = {
  sm: 'h-[26px] gap-1 px-2 text-xs',
  md: 'h-[var(--ui-control-height-lg)] gap-2 px-3 text-sm',
}

const TRIGGER_TONE: Record<SelectTriggerTone, string> = {
  outline:
    'w-full rounded-md border border-input bg-background shadow-sm hover:bg-muted/40 data-[popup-open]:border-ring',
  plain:
    'w-auto max-w-full rounded-lg border-0 bg-transparent shadow-none hover:bg-accent data-[popup-open]:bg-accent',
}

const TRIGGER_ICON: Record<SelectTriggerSize, string> = {
  sm: 'size-3.5',
  md: 'size-4',
}

/*
 * 弹出层宽度自适应内容，锚点宽度只是下限。
 *
 * 下限来自 Base UI Positioner 暴露的 --anchor-width，不再由 React 读
 * offsetWidth 再 setState：那既在 commit 阶段强制同步布局，又在窗口尺寸、
 * 字号与文案长度变化后不会更新，首帧还得先猜一个 200。
 */
const POPUP_MIN_INLINE_SIZE = '168px'
const POPUP_MAX_INLINE_SIZE = '320px'

export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  function SelectTrigger(
    { children, className, size = 'md', tone = 'outline', ...props },
    forwardedRef,
  ) {
    const { data, type, value, setSize } = useSelectContext()
    const selectedItem = data.find((item) => item.value === value)

    useEffect(() => {
      setSize(size)
    }, [size, setSize])

    return (
      <BaseSelect.Trigger
        className={cn(
          'flex items-center justify-between',
          'text-left text-foreground',
          'outline-none',
          'transition-[border-color,box-shadow,background-color]',
          'focus-visible:ring-2',
          'focus-visible:ring-ring',
          'disabled:cursor-not-allowed',
          'disabled:opacity-50',
          TRIGGER_SIZE[size],
          TRIGGER_TONE[tone],
          className,
        )}
        ref={forwardedRef}
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
                className={cn(TRIGGER_ICON[size], 'shrink-0', 'text-muted-foreground')}
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
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        align="start"
        alignItemWithTrigger={false}
        className={popupPositionerClassName}
        sideOffset={4}
      >
        <BaseSelect.Popup
          className={cn(popupSurfaceClassName, 'shadow-xl', className)}
          ref={ref}
          style={{
            minInlineSize: `max(var(--anchor-width), ${POPUP_MIN_INLINE_SIZE})`,
            maxInlineSize: POPUP_MAX_INLINE_SIZE,
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

const ITEM_SIZE: Record<SelectTriggerSize, string> = {
  sm: 'min-h-8 px-2 py-1 text-xs',
  md: 'min-h-9 px-2 py-1.5 text-sm',
}

export const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(function SelectItem(
  { children, className, value, ...props },
  ref,
) {
  const { size } = useSelectContext()

  return (
    <BaseSelect.Item
      className={cn(
        'group relative flex',
        ITEM_SIZE[size],
        'cursor-default select-none',
        'items-center gap-2',
        'rounded-sm',
        'outline-none',
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
