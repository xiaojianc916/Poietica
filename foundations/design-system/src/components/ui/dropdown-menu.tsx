import { Menu } from '@base-ui/react/menu'
import { ChevronRight } from '@mynaui/icons-react'
import { type ComponentPropsWithoutRef, forwardRef } from 'react'
import { cn } from '../../lib/utils'

export const DropdownMenu = Menu.Root

export const DropdownMenuGroup = Menu.Group

export const DropdownMenuPortal = Menu.Portal

export const DropdownMenuSub = Menu.SubmenuRoot

export const DropdownMenuRadioGroup = Menu.RadioGroup

export const DropdownMenuRadioItemIndicator = Menu.RadioItemIndicator

export const DropdownMenuTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Menu.Trigger>
>(function DropdownMenuTrigger({ className, ...props }, ref) {
  return (
    <Menu.Trigger
      className={cn(
        'outline-none',
        'focus-visible:ring-2',
        'focus-visible:ring-ring',
        'focus-visible:ring-offset-2',
        'disabled:pointer-events-none',
        'disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  )
})

type DropdownMenuContentProps = ComponentPropsWithoutRef<typeof Menu.Popup> & {
  readonly sideOffset?: number
  readonly side?: ComponentPropsWithoutRef<typeof Menu.Positioner>['side']
  readonly align?: ComponentPropsWithoutRef<typeof Menu.Positioner>['align']
}

const popupClassName = [
  'min-w-32 overflow-hidden',
  'rounded-md border border-divider',
  'bg-popover p-1',
  'text-popover-foreground',
  'shadow-md outline-none',
  'origin-[var(--transform-origin)]',
  'transition-[transform,scale,opacity]',
  'duration-[var(--ui-duration-fast)]',
  'data-[starting-style]:scale-95',
  'data-[starting-style]:opacity-0',
  'data-[ending-style]:scale-95',
  'data-[ending-style]:opacity-0',
].join(' ')

export const DropdownMenuContent = forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  function DropdownMenuContent(
    { className, sideOffset = 6, side = 'bottom', align = 'start', ...props },
    ref,
  ) {
    return (
      <Menu.Portal>
        <Menu.Positioner
          align={align}
          className="z-[var(--ui-z-popover)] outline-none"
          side={side}
          sideOffset={sideOffset}
        >
          <Menu.Popup className={cn(popupClassName, className)} ref={ref} {...props} />
        </Menu.Positioner>
      </Menu.Portal>
    )
  },
)

/*
 * One menu row, stated once.
 *
 * Item and SubmenuTrigger were two copies of the same twelve classes, and a
 * radio row would have made three. The only difference belongs to the trigger,
 * which also paints while its submenu is open, so it adds that one class
 * instead of restating the rest.
 */
const itemClassName = [
  'relative flex min-h-9',
  'cursor-default select-none',
  'items-center gap-2',
  'rounded-sm px-2 py-1.5',
  'text-sm outline-none',
  'transition-colors',
  'focus:bg-accent',
  'focus:text-accent-foreground',
  'data-[highlighted]:bg-accent',
  'data-[highlighted]:text-accent-foreground',
  'data-[disabled]:pointer-events-none',
  'data-[disabled]:opacity-50',
].join(' ')

/*
 * A command in a menu. Its callback is onClick, because that is the callback
 * this menu has: Base UI's Menu.Item takes onClick and closes on click by
 * default. onSelect is a DOM event about text selection, and passing it here
 * type-checks, builds, and never fires.
 */
export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Menu.Item>
>(function DropdownMenuItem({ className, ...props }, ref) {
  return <Menu.Item className={cn(itemClassName, className)} ref={ref} {...props} />
})

/*
 * A row that reports which value is in force.
 *
 * The role, aria-checked, the arrow keys and the mounting of the indicator all
 * belong to the group rather than to a data attribute: RadioGroup holds the
 * value, and the row whose value matches is the one that shows its indicator.
 */
export const DropdownMenuRadioItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Menu.RadioItem>
>(function DropdownMenuRadioItem({ className, ...props }, ref) {
  return <Menu.RadioItem className={cn(itemClassName, className)} ref={ref} {...props} />
})

export const DropdownMenuLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Menu.GroupLabel>
>(function DropdownMenuLabel({ className, ...props }, ref) {
  return (
    <Menu.GroupLabel
      className={cn('px-2 py-1.5', 'text-sm font-semibold', 'text-foreground', className)}
      ref={ref}
      {...props}
    />
  )
})

export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Menu.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <Menu.Separator
      className={cn('-mx-1 my-1 h-px', 'bg-divider', className)}
      ref={ref}
      {...props}
    />
  )
})

export const DropdownMenuShortcut = forwardRef<HTMLSpanElement, ComponentPropsWithoutRef<'span'>>(
  function DropdownMenuShortcut({ className, ...props }, ref) {
    return (
      <span
        className={cn('ml-auto', 'text-xs tracking-widest', 'text-muted-foreground', className)}
        ref={ref}
        {...props}
      />
    )
  },
)

export const DropdownMenuSubTrigger = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Menu.SubmenuTrigger>
>(function DropdownMenuSubTrigger({ className, children, ...props }, ref) {
  return (
    <Menu.SubmenuTrigger
      className={cn(itemClassName, 'data-[popup-open]:bg-accent', className)}
      ref={ref}
      {...props}
    >
      {children}

      <ChevronRight aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
    </Menu.SubmenuTrigger>
  )
})

type DropdownMenuSubContentProps = ComponentPropsWithoutRef<typeof Menu.Popup> & {
  readonly sideOffset?: number
  readonly side?: ComponentPropsWithoutRef<typeof Menu.Positioner>['side']
  readonly align?: ComponentPropsWithoutRef<typeof Menu.Positioner>['align']
}

export const DropdownMenuSubContent = forwardRef<HTMLDivElement, DropdownMenuSubContentProps>(
  function DropdownMenuSubContent(
    { className, sideOffset = 4, side = 'right', align = 'start', ...props },
    ref,
  ) {
    return (
      <Menu.Positioner
        align={align}
        className="z-[var(--ui-z-popover)] outline-none"
        side={side}
        sideOffset={sideOffset}
      >
        <Menu.Popup className={cn(popupClassName, className)} ref={ref} {...props} />
      </Menu.Positioner>
    )
  },
)
