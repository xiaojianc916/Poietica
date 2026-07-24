import { type ComponentPropsWithoutRef, forwardRef } from 'react'

import { cn } from '../../lib/utils'

export type LabelProps = ComponentPropsWithoutRef<'label'>

/**
 * 通用表单标签组件。
 *
 * 可直接包裹 Switch，也可以通过 htmlFor
 * 关联其他原生表单控件。
 */
export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, ...props },
  forwardedRef,
) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: 通用标签由调用处通过 htmlFor 或嵌套控件建立关联
    <label
      className={cn(
        'text-sm font-medium leading-none',
        'select-none',
        'has-[:disabled]:cursor-not-allowed',
        'has-[:disabled]:opacity-70',
        className,
      )}
      ref={forwardedRef}
      {...props}
    />
  )
})
