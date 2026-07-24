import { Menu } from '@base-ui/react/menu'
import { ChevronRight } from '@mynaui/icons-react'
import { type ComponentPropsWithoutRef, forwardRef } from 'react'
import { cn } from '../../lib/utils'

export const DropdownMenu = Menu.Root

export const DropdownMenuGroup = Menu.Group

export const DropdownMenuPortal = Menu.Portal

export const DropdownMenuSub = Menu.SubmenuRoot

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

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Menu.Item>
>(function DropdownMenuItem({ className, ...props }, ref) {
  return (
    <Menu.Item
      className={cn(
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
        className,
      )}
      ref={ref}
      {...props}
    />
  )
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
      className={cn(
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
        'data-[popup-open]:bg-accent',
        'data-[disabled]:pointer-events-none',
        'data-[disabled]:opacity-50',
        className,
      )}
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
