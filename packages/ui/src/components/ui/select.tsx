import { Select as BaseSelect } from '@base-ui/react/select'
import { Check, ChevronDown } from '@mynaui/icons-react'
import { type ComponentProps, createContext, type ReactNode, useContext, useMemo } from 'react'
import { cn } from '../../lib/utils'
import { popupPositionerClassName, popupSurfaceClassName } from './popup-surface'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

/*
 * context 里只放基元不知道的东西。
 *
 * 选项表与当前值它都知道 —— 前者由 Root 的 items 收着，后者本来就是 Root 的
 * 状态。此前两样各被交出去两遍：一遍给基元，一遍给这个 context，于是"现在选中
 * 的是哪一项"有了两个出处，只靠同一个 prop 同时喂两边才恰好不打架。
 *
 * 剩下这两个是本仓自己的概念：type 只为那句占位文案存在，size 要让触发器、
 * 面板与每一行同档，而档位在 render 期间就得定下来。
 */
interface SelectContextValue {
  readonly type: string
  readonly size: SelectTriggerSize
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
  /**
   * 触发器与选项行必须同档，所以档位属于整个 Select，不属于触发器：
   * 它在 render 期间就进 context，选项行首帧即正确。
   */
  readonly size?: SelectTriggerSize
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
  size = 'md',
  onValueChange,
  onOpenChange,
}: SelectProps) {
  /* context 的值必须有稳定身份，否则每次渲染都让触发器、面板与每一行重画一遍。 */
  const selection = useMemo<SelectContextValue>(() => ({ type, size }), [size, type])

  return (
    <SelectContext value={selection}>
      {/*
       * 选项表交给基元。
       *
       * 官方文档：指定 items 之后，Select.Value 渲染的是选中项的标签而不是原始
       * 值；而当每一项的形状是 { value, label } 时，标签会被自动取用，连
       * itemToStringLabel 都不必写 —— 本仓的 SelectOption 恰好就是这个形状。
       *
       * 它不接管列表渲染：官方示例里 items 与手写的 Item 子节点是并存的，前者只
       * 是一张查找表。所以调用点一处都不用改。
       *
       * 顺带解掉了另一半：此前设置页每次渲染新建一个数组交进来，那个数组是
       * context 值的依赖之一，于是下游整片重画。现在它不再进 context。
       */}
      <BaseSelect.Root<string>
        defaultOpen={defaultOpen}
        disabled={disabled}
        items={data}
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
    </SelectContext>
  )
}

export type SelectTriggerSize = 'sm' | 'md'

export type SelectTriggerTone = 'outline' | 'plain'

export type SelectTriggerProps = ComponentProps<typeof BaseSelect.Trigger> & {
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

/*
 * 上限跟着档位走，不是一个通用数。
 *
 * sm 档的 220px 与设置页 .settings-select-trigger 的上限同数：面板的水平范围
 * 由锚点决定，不由内容随意撑开，否则勾号被推到很远，和标签之间空出一大片。
 */
const POPUP_MAX_INLINE_SIZE: Record<SelectTriggerSize, string> = {
  sm: '220px',
  md: '320px',
}

export function SelectTrigger({
  children,
  className,
  tone = 'outline',
  ...props
}: SelectTriggerProps) {
  const { type, size } = useSelectContext()

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
      type="button"
      {...props}
    >
      {children ?? (
        <>
          {/*
            标签、查找与占位都归基元。此前这里是一次线性扫描加一个 <span> 加一个
            ?? 兜底 —— 三样东西各自重写了一遍 Select.Value 已经做的事。
            Value 渲染的就是一个 <span>，所以类名原样落在它身上，DOM 结构不变。
          */}
          <BaseSelect.Value
            className={cn('min-w-0 flex-1', 'truncate')}
            placeholder={`选择${type}…`}
          />

          {/*
            ChevronDown 而不是 ChevronsUpDown：双向箭头说的是"有一根轴能上下
            走"，那是 combobox / 步进器的记号（见 combobox.tsx）。这里是有限
            离散值的弹出菜单，说的是"下面会展开一张列表"。
          */}
          <BaseSelect.Icon>
            <ChevronDown
              aria-hidden="true"
              className={cn(TRIGGER_ICON[size], 'shrink-0', 'text-muted-foreground')}
            />
          </BaseSelect.Icon>
        </>
      )}
    </BaseSelect.Trigger>
  )
}

/** 面板沿触发器的哪一条边展开。值右对齐的行用 end，与触发器同一条边。 */
export type SelectContentAlign = 'start' | 'end'

export type SelectContentProps = ComponentProps<typeof BaseSelect.Popup> & {
  readonly align?: SelectContentAlign
}

export function SelectContent({ align = 'start', className, style, ...props }: SelectContentProps) {
  const { size } = useSelectContext()

  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        align={align}
        alignItemWithTrigger={false}
        className={popupPositionerClassName}
        sideOffset={4}
      >
        <BaseSelect.Popup
          className={cn(popupSurfaceClassName, className)}
          style={{
            minInlineSize: `max(var(--anchor-width), ${POPUP_MIN_INLINE_SIZE})`,
            maxInlineSize: POPUP_MAX_INLINE_SIZE[size],
            ...style,
          }}
          {...props}
        />
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  )
}

export type SelectListProps = ComponentProps<typeof BaseSelect.List>

export function SelectList({ className, ...props }: SelectListProps) {
  return (
    <BaseSelect.List
      className={cn(
        'max-h-64',
        'overflow-y-auto',
        'overscroll-contain',
        'p-1 outline-none',
        className,
      )}
      {...props}
    />
  )
}

export type SelectGroupProps = ComponentProps<typeof BaseSelect.Group>

export function SelectGroup({ className, ...props }: SelectGroupProps) {
  return <BaseSelect.Group className={cn('grid gap-0.5', className)} {...props} />
}

export type SelectItemProps = Omit<ComponentProps<typeof BaseSelect.Item>, 'value'> & {
  readonly value: string
}

/*
 * 行高比触发器高 2px，字号与触发器同档：菜单是控件的展开，不是新界面。
 * sm 档的 28px / 12px 与编排器菜单同值。
 */
const ITEM_SIZE: Record<SelectTriggerSize, string> = {
  sm: 'min-h-7 px-2 text-xs',
  md: 'min-h-9 px-2 py-1.5 text-sm',
}

/* 行圆角比面板圆角小一档，且都不用卡片圆角。 */
const ITEM_SHAPE: Record<SelectTriggerSize, string> = {
  sm: 'rounded-[5px]',
  md: 'rounded-sm',
}

export function SelectItem({ children, className, value, ...props }: SelectItemProps) {
  const { size } = useSelectContext()

  return (
    <BaseSelect.Item
      className={cn(
        'group relative flex',
        ITEM_SIZE[size],
        'cursor-default select-none',
        'items-center gap-2',
        ITEM_SHAPE[size],
        'outline-none',
        'transition-colors',
        /*
         * 高亮是中性的：勾号说"当前生效的值"，高亮说"指针或键盘现在指着谁"。
         * 用 --ui-accent 去画一个瞬时指向，等于给临时状态派了个语义色，而它
         * 还是命令面板与菜单的全局强调色，改动波及整个应用。
         */
        'data-[highlighted]:bg-[var(--ui-sidebar-accent)]',
        'data-[highlighted]:text-[var(--ui-foreground)]',
        'data-[disabled]:pointer-events-none',
        'data-[disabled]:opacity-50',
        className,
      )}
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
}

export type SelectSeparatorProps = ComponentProps<typeof BaseSelect.Separator>

export function SelectSeparator({ className, ...props }: SelectSeparatorProps) {
  return (
    <BaseSelect.Separator className={cn('-mx-1 my-1 h-px', 'bg-divider', className)} {...props} />
  )
}
