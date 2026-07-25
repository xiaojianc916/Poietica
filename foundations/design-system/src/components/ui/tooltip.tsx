import { Tooltip } from '@base-ui/react/tooltip'
import * as React from 'react'
import { forwardRef } from 'react'
import { cn } from '../../lib/utils'

const TooltipProvider = ({
  delayDuration,
  children,
  closeDelay,
  timeout,
}: React.ComponentPropsWithoutRef<typeof Tooltip.Provider> & {
  readonly delayDuration?: number
}) => (
  <Tooltip.Provider closeDelay={closeDelay} delay={delayDuration} timeout={timeout}>
    {children}
  </Tooltip.Provider>
)
TooltipProvider.displayName = 'TooltipProvider'

const TooltipRoot = Tooltip.Root

const TooltipTrigger = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Tooltip.Trigger> & { readonly asChild?: boolean }
>(({ asChild = false, children, ...props }, ref) => {
  const child = React.Children.only(children)
  const renderElement = asChild && React.isValidElement(child) ? child : undefined

  return <Tooltip.Trigger ref={ref} render={renderElement} {...props} />
})
TooltipTrigger.displayName = 'TooltipTrigger'

const TooltipContent = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Tooltip.Popup> & {
    readonly sideOffset?: number
    readonly side?: string
  }
>(({ className, sideOffset = 4, side, ...props }, ref) => (
  <Tooltip.Portal>
    <Tooltip.Positioner
      className="z-[var(--ui-z-popover,50)]"
      side={side as Tooltip.Positioner.Props['side']}
      sideOffset={sideOffset}
    >
      <Tooltip.Popup
        className={cn(
          'overflow-hidden rounded-md bg-neutral-900 dark:bg-neutral-100 px-3 py-1.5 text-xs text-neutral-50 dark:text-neutral-900 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        ref={ref}
        {...props}
      />
    </Tooltip.Positioner>
  </Tooltip.Portal>
))
TooltipContent.displayName = 'TooltipContent'

export { TooltipContent, TooltipProvider, TooltipRoot as Tooltip, TooltipTrigger }
