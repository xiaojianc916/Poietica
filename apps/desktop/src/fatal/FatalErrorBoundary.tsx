import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportFatalIncident } from './fatal-runtime'

export interface FatalErrorBoundaryProps {
  readonly children: ReactNode
}

interface FatalErrorBoundaryState {
  readonly crashed: boolean
}

export class FatalErrorBoundary extends Component<
  FatalErrorBoundaryProps,
  FatalErrorBoundaryState
> {
  override state: FatalErrorBoundaryState = {
    crashed: false,
  }

  static getDerivedStateFromError(): FatalErrorBoundaryState {
    return {
      crashed: true,
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? undefined

    reportFatalIncident({
      impact: 'application-fatal',
      error,
      kind: 'render',
      phase: 'running',
      code: 'FATAL_REACT_RENDER_ERROR',
      ...(componentStack === undefined
        ? {}
        : {
            componentStack,
          }),
      context: {
        collector: 'react-error-boundary',
      },
    })
  }

  override render(): ReactNode {
    if (this.state.crashed) {
      // FatalErrorHost owns the only global fatal UI.
      return null
    }

    return this.props.children
  }
}
