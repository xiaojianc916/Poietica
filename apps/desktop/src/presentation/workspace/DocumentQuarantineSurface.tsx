import { DangerTriangle, X } from '@mynaui/icons-react'

export interface DocumentQuarantineSurfaceProps {
  readonly onClose: () => void
}

export function DocumentQuarantineSurface({ onClose }: DocumentQuarantineSurfaceProps) {
  return (
    <main
      aria-live="assertive"
      className={['grid size-full', 'place-items-center', 'bg-background', 'px-8 py-12'].join(' ')}
      role="alert"
    >
      <section className={['grid w-full', 'max-w-xl gap-5'].join(' ')}>
        <div
          aria-hidden="true"
          className={[
            'grid size-12',
            'place-items-center',
            'rounded-full',
            'bg-destructive/10',
            'text-destructive',
          ].join(' ')}
        >
          <DangerTriangle className="size-6" />
        </div>

        <div className="grid gap-2">
          <h1 className={['text-xl font-semibold', 'tracking-tight'].join(' ')}>
            当前画布已被隔离
          </h1>

          <p className={['max-w-lg', 'text-sm leading-6', 'text-muted-foreground'].join(' ')}>
            画布渲染过程中发生了无法安全恢复的错误。
            为避免损坏其他画布或应用状态，当前画布已经停止运行。 其他画布仍可正常使用。
          </p>
        </div>

        <div className={['border-t', 'border-border', 'pt-4'].join(' ')}>
          <button
            className={[
              'inline-flex h-9',
              'items-center gap-2',
              'rounded-md',
              'bg-foreground',
              'px-4 text-sm',
              'font-medium',
              'text-background',
              'hover:opacity-90',
              'focus-visible:outline-none',
              'focus-visible:ring-2',
              'focus-visible:ring-ring',
            ].join(' ')}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
            关闭此画布
          </button>
        </div>
      </section>
    </main>
  )
}
