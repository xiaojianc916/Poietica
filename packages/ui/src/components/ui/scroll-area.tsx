import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/*
 * 先声明滚动条，再声明容器。
 *
 * 此前顺序相反：容器的 JSX 里用 <ScrollBar />，而它是同文件下方的 const ——
 * 靠「引用发生在渲染回调里、模块求值早已结束」才没炸。声明先于使用之后，
 * 这个文件可以从上往下读，不必先记住一个还没出现的名字。
 */
function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ComponentProps<typeof BaseScrollArea.Scrollbar>) {
  return (
    <BaseScrollArea.Scrollbar
      className={cn(
        'flex touch-none select-none transition-colors',
        orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-px',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-px',
        className,
      )}
      orientation={orientation}
      {...props}
    >
      <BaseScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
    </BaseScrollArea.Scrollbar>
  )
}

/*
 * 导入改名为 BaseScrollArea，函数因此可以直接叫 ScrollArea。
 *
 * 此前函数名后面缀着 Component，再用 displayName 纠回正名，导出处还要 as
 * 一次 —— 三处在说同一个名字。本目录另外几个文件（select / combobox /
 * dialog / drawer / switch / toast）本来就是 import { X as BaseX } 的形制，
 * 这里跟它们对齐。
 */
function ScrollArea({ children, className, ...props }: ComponentProps<typeof BaseScrollArea.Root>) {
  return (
    <BaseScrollArea.Root className={cn('relative overflow-hidden', className)} {...props}>
      <BaseScrollArea.Viewport className="size-full rounded-[inherit]">
        <BaseScrollArea.Content>{children}</BaseScrollArea.Content>
      </BaseScrollArea.Viewport>
      <ScrollBar />
      <BaseScrollArea.Corner />
    </BaseScrollArea.Root>
  )
}

/*
 * 滚动条不外露。
 *
 * 它此前是包的公开导出，而全仓一处引用都没有。更要紧的是：容器自己已经渲染了
 * 一条，而 children 落在 Content 里面 —— 外部真传一条进去，它会跟着内容一起滚，
 * 位置是错的。一个没人用、且用法必错的导出，留着只会等人踩。
 */
export { ScrollArea }
