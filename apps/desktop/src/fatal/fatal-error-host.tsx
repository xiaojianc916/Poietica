import { type ReactNode, useSyncExternalStore } from 'react'
import { failureCoordinator } from '../failures/failure-coordinator'
import { FatalErrorBoundary } from './fatal-error-boundary'
import { FatalErrorScreen } from './fatal-error-screen'

export interface FatalErrorHostProps {
  readonly children: ReactNode
}

export function FatalErrorHost({ children }: FatalErrorHostProps) {
  const snapshot = useSyncExternalStore(
    failureCoordinator.subscribe,
    failureCoordinator.getSnapshot,
    failureCoordinator.getSnapshot,
  )

  if (snapshot.terminal) {
    return (
      <FatalErrorScreen
        additionalIncidentCount={snapshot.terminal.additionalIncidentCount}
        incident={snapshot.terminal.incident}
      />
    )
  }

  return <FatalErrorBoundary>{children}</FatalErrorBoundary>
}
