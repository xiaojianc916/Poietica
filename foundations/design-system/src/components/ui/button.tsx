import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
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
      },
      size: {
        default: 'h-[var(--ui-control-height-md)] px-4 py-2',
        /* xs 与开关、下拉触发器同档（26px）：一行设置里不该出现三种控件高度。 */
        xs: 'h-[26px] rounded-lg px-2.5 text-xs',
        sm: 'h-[var(--ui-control-height-sm)] rounded-md px-3 text-xs',
        lg: 'h-[var(--ui-control-height-lg)] rounded-md px-8',
        icon: 'h-[var(--ui-control-height-md)] w-[var(--ui-control-height-md)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  readonly asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, ...props }, ref) => {
    const renderElement = asChild && React.isValidElement(children) ? children : undefined

    const element = useRender({
      defaultTagName: 'button',
      render: renderElement,
      props: { ...props, children: renderElement ? undefined : children, ref },
    })

    const classNameValue = cn(buttonVariants({ variant, size, className }))

    if (React.isValidElement(element)) {
      return React.cloneElement(element as React.ReactElement<React.HTMLAttributes<HTMLElement>>, {
        className: cn(
          classNameValue,
          (element.props as React.HTMLAttributes<HTMLElement>).className,
        ),
      })
    }

    return element
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
