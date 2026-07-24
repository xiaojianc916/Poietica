import type { FailureImpact } from '@hybrid-canvas/foundations-kernel'
import { DangerCircle, X } from '@mynaui/icons-react'
import { useEffect, useSyncExternalStore } from 'react'
import {
  failureCoordinator,
  type NonTerminalFailureIncident,
  type PresentedFailure,
} from '../../application/failures/failure-coordinator'

type ToastFailureImpact = Extract<FailureImpact, 'recoverable' | 'feature-degraded'>

type ToastIncident = NonTerminalFailureIncident & {
  readonly impact: ToastFailureImpact
}

type ToastFailure = Omit<PresentedFailure, 'incident'> & {
  readonly incident: ToastIncident
}

export function UiFeedbackRegion() {
  const snapshot = useSyncExternalStore(
    failureCoordinator.subscribe,
    failureCoordinator.getSnapshot,
    failureCoordinator.getSnapshot,
  )

  const visible = selectVisibleFailures([
    ...snapshot.operations,

    ...snapshot.degradedFeatures.values(),
  ]).slice(-3)

  useEffect(() => {
    const timers = visible.map((entry) => {
      const duration = entry.incident.impact === 'feature-degraded' ? 9_000 : 5_500

      return window.setTimeout(() => {
        failureCoordinator.dismiss(entry.incident.id)
      }, duration)
    })

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
    }
  }, [visible])

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className={[
        'pointer-events-none',
        'fixed bottom-4 right-4',
        'z-[var(--ui-z-toast)]',
        'grid gap-2',
        'w-[min(380px,calc(100vw-32px))]',
      ].join(' ')}
    >
      {visible.map((entry) => {
        const incident = entry.incident

        return (
          <div
            className={[
              'pointer-events-auto',
              'flex items-start gap-3',
              'rounded-lg border',
              incident.impact === 'feature-degraded'
                ? 'border-warning/40'
                : 'border-destructive/30',
              'bg-background p-3',
              'text-sm shadow-xl',
            ].join(' ')}
            key={incident.id}
            role="alert"
          >
            <DangerCircle
              aria-hidden="true"
              className={[
                'mt-0.5 size-4',
                'shrink-0',
                incident.impact === 'feature-degraded' ? 'text-warning' : 'text-destructive',
              ].join(' ')}
            />

            <div className="grid min-w-0 flex-1 gap-1">
              <span className="leading-5">{incident.userMessage}</span>

              <span className="text-xs text-muted-foreground">
                {incident.impact === 'feature-degraded' ? '功能受限' : '操作失败'}

                {' · '}
                {incident.code}

                {entry.occurrences > 1 ? ' · ' + String(entry.occurrences) + ' 次' : ''}
              </span>
            </div>

            <button
              aria-label="关闭提示"
              className={[
                'grid size-7',
                'place-items-center',
                'rounded-md',
                'text-muted-foreground',
                'hover:bg-accent',
                'focus-visible:outline-none',
                'focus-visible:ring-2',
                'focus-visible:ring-ring',
              ].join(' ')}
              onClick={() => {
                failureCoordinator.dismiss(incident.id)
              }}
              type="button"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function selectVisibleFailures(failures: readonly PresentedFailure[]): ToastFailure[] {
  return failures.filter((entry): entry is ToastFailure => {
    if (!entry.noticeVisible) {
      return false
    }

    return entry.incident.impact === 'recoverable' || entry.incident.impact === 'feature-degraded'
  })
}
