import { Tabs } from '@base-ui/react/tabs'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

const TabsRoot = Tabs.Root

function TabsList({ className, ...props }: ComponentProps<typeof Tabs.List>) {
  return (
    <Tabs.List
      className={cn(
        'inline-flex h-[var(--ui-control-height-md)] items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof Tabs.Tab>) {
  return (
    <Tabs.Tab
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: ComponentProps<typeof Tabs.Panel>) {
  return (
    <Tabs.Panel
      className={cn(
        'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      {...props}
    />
  )
}

export { TabsContent, TabsList, TabsRoot as Tabs, TabsTrigger }
