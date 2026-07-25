import type { ComponentProps } from 'react'

import { cn } from '../../lib/utils'

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base',
        'shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  )
}
