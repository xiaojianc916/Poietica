import { Tabs } from '@base-ui/react/tabs'
import { forwardRef } from 'react'
import { cn } from '../../lib/utils'

const TabsRoot = Tabs.Root

const TabsList = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Tabs.List>>(
  ({ className, ...props }, ref) => (
    <Tabs.List
      className={cn(
        'inline-flex h-[var(--ui-control-height-md)] items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
)
TabsList.displayName = 'TabsList'

const TabsTrigger = forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof Tabs.Tab>>(
  ({ className, ...props }, ref) => (
    <Tabs.Tab
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
)
TabsTrigger.displayName = 'TabsTrigger'

const TabsContent = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Tabs.Panel>>(
  ({ className, ...props }, ref) => (
    <Tabs.Panel
      className={cn(
        'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
)
TabsContent.displayName = 'TabsContent'

export { TabsContent, TabsList, TabsRoot as Tabs, TabsTrigger }
