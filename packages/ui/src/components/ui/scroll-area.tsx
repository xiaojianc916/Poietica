import { ScrollArea } from '@base-ui/react/scroll-area'
import { forwardRef } from 'react'
import { cn } from '../../lib/utils'

const ScrollAreaComponent = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ScrollArea.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollArea.Root className={cn('relative overflow-hidden', className)} ref={ref} {...props}>
    <ScrollArea.Viewport className="size-full rounded-[inherit]">
      <ScrollArea.Content>{children}</ScrollArea.Content>
    </ScrollArea.Viewport>
    <ScrollBar />
    <ScrollArea.Corner />
  </ScrollArea.Root>
))
ScrollAreaComponent.displayName = 'ScrollArea'

const ScrollBar = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ScrollArea.Scrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollArea.Scrollbar
    className={cn(
      'flex touch-none select-none transition-colors',
      orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-px',
      orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-px',
      className,
    )}
    orientation={orientation}
    ref={ref}
    {...props}
  >
    <ScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
  </ScrollArea.Scrollbar>
))
ScrollBar.displayName = 'ScrollBar'

export { ScrollAreaComponent as ScrollArea, ScrollBar }
