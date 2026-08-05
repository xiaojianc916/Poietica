import { Separator as SeparatorRoot } from '@base-ui/react/separator'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/*
 * 类型不再走 React.* 全局命名空间。
 *
 * 这个文件（还有 tabs.tsx、scroll-area.tsx）从头到尾没有 import React，
 * 却在写 React.ComponentRef / React.ComponentPropsWithoutRef —— 能编过是
 * 因为 @types/react 还挂着 React 17 之前的 UMD 全局声明。同目录另外十几个
 * 文件是直接具名导入的，这里跟它们对齐。
 */
function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: ComponentProps<typeof SeparatorRoot>) {
  return (
    <SeparatorRoot
      className={cn(
        'shrink-0 bg-divider',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      orientation={orientation}
      {...props}
    />
  )
}

export { Separator }
