import { useRender } from '@base-ui/react/use-render'
import {
  type ButtonHTMLAttributes,
  cloneElement,
  forwardRef,
  type HTMLAttributes,
  isValidElement,
  type ReactElement,
} from 'react'
import { cn } from '../../lib/utils'

/*
 * 变体表。
 *
 * 此前这张表由 class-variance-authority 生成。那个包最后一次发版就是 0.7.1，
 * v1 停在 beta 没有落地，至今仍是 0.x；而在这个仓库里它只被这一个文件用到 ——
 * 同一目录下另外十八个组件表达同一件事用的是查找表（switch.tsx 的 ROOT_SIZE /
 * THUMB_SIZE 最直白）。为一个只服务一处、且已停更的依赖养着第二种变体写法，
 * 是两套管线，不是灵活。
 *
 * 对外签名一字不改：buttonVariants({ variant, size, className }) 仍返回一个
 * class 字符串，所以包外的调用方不需要跟着动。档位从"由 cva 推导"变成写出来的
 * 联合类型 —— 有哪几档，现在在类型里直接读得到。
 */

const BASE =
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

export type ButtonVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'secondary'
  | 'soft'
  | 'ghost'
  | 'link'

export type ButtonSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon'

const VARIANT: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
  destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
  outline:
    'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
  secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
  /*
   * soft：无边框、无投影，填充用 divider 那一档灰。
   *
   * 面板本身已经没有边框，再给按钮画边框它就成了页面上唯一的框。
   * 可点性由一层浅填充表达，深浅跟着 divider token 走，
   * 所以它和分割线永远是同一个灰阶，不需要第二处色值。
   */
  soft: 'bg-divider text-foreground hover:bg-divider/70',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
}

const SIZE: Record<ButtonSize, string> = {
  default: 'h-[var(--ui-control-height-md)] px-4 py-2',
  /* xs 与开关、下拉触发器同档（26px）：一行设置里不该出现三种控件高度。 */
  xs: 'h-[26px] rounded-lg px-2.5 text-xs',
  sm: 'h-[var(--ui-control-height-sm)] rounded-md px-3 text-xs',
  lg: 'h-[var(--ui-control-height-lg)] rounded-md px-8',
  icon: 'h-[var(--ui-control-height-md)] w-[var(--ui-control-height-md)]',
}

export interface ButtonVariantOptions {
  readonly variant?: ButtonVariant | null | undefined
  readonly size?: ButtonSize | null | undefined
  readonly className?: string | undefined
}

/** 一档变体 + 一档尺寸 + 调用方补充的 class，合成最终 class 字符串。 */
export function buttonVariants({ variant, size, className }: ButtonVariantOptions = {}): string {
  return cn(BASE, VARIANT[variant ?? 'default'], SIZE[size ?? 'default'], className)
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantOptions {
  readonly asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, ...props }, ref) => {
    const renderElement = asChild && isValidElement(children) ? children : undefined

    const element = useRender({
      defaultTagName: 'button',
      render: renderElement,
      props: { ...props, children: renderElement ? undefined : children, ref },
    })

    const classNameValue = buttonVariants({ variant, size, className })

    if (isValidElement(element)) {
      return cloneElement(element as ReactElement<HTMLAttributes<HTMLElement>>, {
        className: cn(classNameValue, (element.props as HTMLAttributes<HTMLElement>).className),
      })
    }

    return element
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
