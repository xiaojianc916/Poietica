import type { FailureImpact } from '@poietica/foundations-kernel'
import { type ToastNotice, ToastRegion } from '@poietica/foundations-design-system'
import { useSyncExternalStore } from 'react'
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

  const notices = visible.map(toToastNotice)

  return (
    <ToastRegion
      notices={notices}
      onDismiss={(incidentId) => {
        failureCoordinator.dismiss(incidentId)
      }}
    />
  )
}

function toToastNotice(entry: ToastFailure): ToastNotice {
  const incident = entry.incident

  const degraded = incident.impact === 'feature-degraded'

  const occurrenceLabel = entry.occurrences > 1 ? ` · ${String(entry.occurrences)} 次` : ''

  return {
    id: incident.id,
    title: incident.userMessage,
    description: [degraded ? '功能受限' : '操作失败', incident.code].join(' · ') + occurrenceLabel,
    tone: degraded ? 'warning' : 'danger',
    duration: degraded ? 9_000 : 5_500,
    priority: degraded ? 'low' : 'high',
  }
}

function selectVisibleFailures(failures: readonly PresentedFailure[]): ToastFailure[] {
  return failures.filter((entry): entry is ToastFailure => {
    if (!entry.noticeVisible) {
      return false
    }

    return entry.incident.impact === 'recoverable' || entry.incident.impact === 'feature-degraded'
  })
}
