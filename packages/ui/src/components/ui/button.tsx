import { useRender } from '@base-ui/react/use-render'
import {
  type ComponentProps,
  cloneElement,
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
 * class 字符串。档位从"由 cva 推导"变成写出来的联合类型 —— 有哪几档，现在在
 * 类型里直接读得到。
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

/*
 * buttonVariants() 的入参。
 *
 * 它和 ButtonProps 是两个不同的契约，不能合并：这里的 className 是"再拼进来的
 * 一段 class"，而 ButtonProps 的 className 是 HTML 属性，由 ButtonHTMLAttributes
 * 提供。cva 时代 VariantProps 只提取 variant 键、不含 className，所以这个区别
 * 一直被掩盖着。
 */
export interface ButtonVariantOptions {
  readonly variant?: ButtonVariant | null | undefined
  readonly size?: ButtonSize | null | undefined
  readonly className?: string | undefined
}

/** 一档变体 + 一档尺寸 + 调用方补充的 class，合成最终 class 字符串。 */
function buttonVariants(options: ButtonVariantOptions = {}): string {
  const { variant, size, className } = options

  return cn(BASE, VARIANT[variant ?? 'default'], SIZE[size ?? 'default'], className)
}

export interface ButtonProps extends ComponentProps<'button'> {
  readonly variant?: ButtonVariant | null | undefined
  readonly size?: ButtonSize | null | undefined
  readonly asChild?: boolean
}

/*
 * ref 交给 useRender 自己的 ref 参数，不再塞进 props。
 *
 * 官方文档把 ref 列为 useRender 的一个独立参数（还支持 ref: [a, b] 合并多个），
 * 此前它是被夹在 props 对象里传下去的 —— 靠 React 19「ref 就是普通属性」才恰好
 * 成立，但那不是这个 API 的用法。
 *
 * 下面那段 cloneElement 保留，它不是冗余：useRender 的 props 参数会把 className
 * 字符串拼接起来，而本仓的 cn 是 twMerge —— 做的是冲突消解。render 元素自带的
 * 类名要在冲突时赢过变体类名，只有走 cn 才成立。
 */
function Button({
  asChild = false,
  children,
  className,
  ref,
  size,
  variant,
  ...props
}: ButtonProps) {
  const renderElement = asChild && isValidElement(children) ? children : undefined

  const element = useRender({
    defaultTagName: 'button',
    ref,
    render: renderElement,
    props: { ...props, children: renderElement ? undefined : children },
  })

  const classNameValue = buttonVariants({ variant, size, className })

  if (isValidElement(element)) {
    return cloneElement(element as ReactElement<HTMLAttributes<HTMLElement>>, {
      className: cn(classNameValue, (element.props as HTMLAttributes<HTMLElement>).className),
    })
  }

  return element
}

export { Button, buttonVariants }
