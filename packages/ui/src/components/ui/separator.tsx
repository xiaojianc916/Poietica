import { Separator as SeparatorRoot } from '@base-ui/react/separator'
import { forwardRef } from 'react'
import { cn } from '../../lib/utils'

const Separator = forwardRef<
  React.ComponentRef<typeof SeparatorRoot>,
  React.ComponentPropsWithoutRef<typeof SeparatorRoot>
>(({ className, orientation = 'horizontal', ...props }, ref) => (
  <SeparatorRoot
    className={cn(
      'shrink-0 bg-divider',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    orientation={orientation}
    ref={ref}
    {...props}
  />
))
Separator.displayName = 'Separator'

export { Separator }
