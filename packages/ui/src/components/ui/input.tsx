import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/*
 * 与 label.tsx 同形：原生元素的属性集就是 ComponentProps<'input'>，
 * 不需要一个空接口去继承它 —— 同一个包里同一件事此前有两种形状。
 *
 * type 也不再被单独取出又原样写回去：它本来就在 props 里，那是 shadcn
 * 模板的遗留，删掉之后行为逐字不变。
 */
export type InputProps = ComponentProps<'input'>

function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'flex h-[var(--ui-control-height-md)] w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
