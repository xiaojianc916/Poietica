import { Tooltip } from '@base-ui/react/tooltip'
import { Children, type ComponentPropsWithoutRef, forwardRef, isValidElement } from 'react'
import { cn } from '../../lib/utils'
import { popupPositionerClassName } from './popup-surface'

/*
 * 两个部件都从 Base UI 的命名空间直接展平，不再手搓转发。
 *
 * 此前 Provider 是个函数包装：它只转发三个属性，却把类型声明成 Tooltip.Provider
 * 的全部属性，而那一行里没有 rest spread —— 于是把别的属性传进来，类型检查通得
 * 过，运行时被静默丢掉。它对外收的也是 Radix 那个属性名，不是 Base UI 的 delay。
 *
 * 与下面注释里记着的 animate-in / data-[state=closed] 是同一笔账：从 Radix 迁到
 * Base UI 只做了一半 —— 类名换完了，属性名和包装留在原地。
 */
const TooltipProvider = Tooltip.Provider

const TooltipRoot = Tooltip.Root

const TooltipTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Tooltip.Trigger> & { readonly asChild?: boolean }
>(({ asChild = false, children, ...props }, ref) => {
  const child = Children.only(children)
  const renderElement = asChild && isValidElement(child) ? child : undefined

  return <Tooltip.Trigger ref={ref} render={renderElement} {...props} />
})
TooltipTrigger.displayName = 'TooltipTrigger'

/*
 * 反色是有意的：提示气泡与它解释的界面对调明暗，才不会被读成界面的一部分。
 *
 * 反色的来源必须是主题令牌，不是 dark: 变体。主题由 :root[data-theme] 驱动，
 * 而 dark: 读的是 prefers-color-scheme——用户手动切主题时两者会脱钩，气泡会朝
 * 着系统的方向翻过去。bg-foreground / text-background 天然跟随 data-theme：
 * 浅色下是深气泡，深色下是浅气泡，反色语义在两个主题里都成立。
 *
 * 进出动画交给 Base UI 的 data-starting-style / data-ending-style。此前这里是
 * 一串 animate-in / data-[state=closed] ——前者来自没有安装的 tailwindcss-animate，
 * 后者是 Radix 的属性名，Base UI 从不发出。整串类名一个都没生效过。
 */
const TooltipContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Tooltip.Popup> & {
    readonly sideOffset?: number
    readonly side?: Tooltip.Positioner.Props['side']
  }
>(({ className, sideOffset = 4, side, ...props }, ref) => (
  <Tooltip.Portal>
    <Tooltip.Positioner className={popupPositionerClassName} side={side} sideOffset={sideOffset}>
      <Tooltip.Popup
        className={cn(
          'overflow-hidden rounded-md px-3 py-1.5 text-xs',
          'bg-foreground text-background',
          'origin-[var(--transform-origin)]',
          'transition-[transform,scale,opacity]',
          'duration-[var(--ui-duration-fast)] ease-[var(--ui-ease-standard)]',
          'data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
          'data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
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
