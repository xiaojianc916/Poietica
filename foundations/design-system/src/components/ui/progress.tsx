import { Progress as BaseProgress } from '@base-ui/react/progress'
import { cn } from '../../lib/utils'

export interface ProgressProps {
  /** 0–100。传 null 表示不确定态（长度未知或尚未开始）。 */
  readonly value: number | null
  readonly label?: string
  readonly valueLabel?: string
  readonly className?: string
}

/**
 * 线性进度条。
 *
 * Base UI 负责 role="progressbar"、aria-valuenow/valuemin/valuemax 与不确定态
 * 的语义；这里只负责视觉令牌。不确定态由 data-indeterminate 驱动样式，不在
 * React 里分支两套 DOM。
 */
export function Progress({ value, label, valueLabel, className }: ProgressProps) {
  return (
    <BaseProgress.Root className={cn('flex w-full flex-col gap-1.5', className)} value={value}>
      {label === undefined && valueLabel === undefined ? null : (
        <div className="flex items-baseline justify-between gap-3 text-muted-foreground text-xs">
          <BaseProgress.Label>{label ?? ''}</BaseProgress.Label>

          <span className="tabular-nums">{valueLabel ?? ''}</span>
        </div>
      )}

      <BaseProgress.Track
        className={cn('relative h-1.5 w-full overflow-hidden rounded-full', 'bg-accent')}
      >
        <BaseProgress.Indicator
          className={cn(
            'h-full rounded-full bg-foreground/80',
            'transition-all duration-[var(--ui-duration-normal)]',
            'ease-[var(--ui-ease-standard)]',
            'data-[indeterminate]:w-1/3 data-[indeterminate]:animate-pulse',
          )}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  )
}
