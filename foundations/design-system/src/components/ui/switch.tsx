import { Switch as BaseSwitch } from '@base-ui/react/switch'
import { type ComponentPropsWithoutRef, forwardRef } from 'react'
import { cn } from '../../lib/utils'

export type SwitchProps = ComponentPropsWithoutRef<typeof BaseSwitch.Root>

/**
 * Hybrid Canvas compact switch.
 *
 * Base UI owns interaction semantics and keyboard behavior.
 * The design system owns sizing, motion, focus and visual states.
 */
export const Switch = forwardRef<HTMLSpanElement, SwitchProps>(function Switch(
  { className, children, ...props },
  forwardedRef,
) {
  return (
    <BaseSwitch.Root
      className={cn(
        'group relative inline-flex',
        'h-[22px] w-[38px] shrink-0',
        'cursor-pointer items-center',
        'rounded-full border',
        'border-transparent',
        'bg-input/70',
        'outline-none',
        'transition-colors',
        'duration-[var(--ui-duration-fast)]',
        'ease-[var(--ui-ease-standard)]',

        'after:absolute',
        'after:-inset-[10px]',
        'after:content-[""]',

        'hover:bg-input',
        'focus-visible:ring-2',
        'focus-visible:ring-ring/40',

        'disabled:cursor-not-allowed',
        'disabled:opacity-45',

        'data-[checked]:bg-primary',
        'data-[unchecked]:bg-input/70',

        'motion-reduce:transition-none',
        className,
      )}
      ref={forwardedRef}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          'pointer-events-none block',
          'size-4',
          'translate-x-[3px]',
          'rounded-full',
          'bg-background',
          'shadow-[var(--ui-shadow-xs)]',
          'ring-1',
          'ring-black/5',

          'transition-transform',
          'duration-[var(--ui-duration-fast)]',
          'ease-[var(--ui-ease-emphasized)]',

          'data-[checked]:translate-x-[19px]',
          'data-[unchecked]:translate-x-[3px]',

          'motion-reduce:transition-none',
        )}
      />

      {children}
    </BaseSwitch.Root>
  )
})
