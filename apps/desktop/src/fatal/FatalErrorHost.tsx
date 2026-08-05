import { type ReactNode, useSyncExternalStore } from 'react'
import { failureCoordinator } from '../state/failures/failure-coordinator'
import { FatalErrorBoundary } from './FatalErrorBoundary'
import { FatalErrorScreen } from './FatalErrorScreen'

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
