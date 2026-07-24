import {
  type ClassifiedFailure,
  type ClassifiedFailureInput,
  createClassifiedFailure,
  createFailureScopeKey,
  type FailureScope,
  isTerminalFailureImpact,
  type NonTerminalFailureImpact,
} from '@hybrid-canvas/foundations-kernel'

export interface PresentedFailure {
  readonly failure: ClassifiedFailure
  readonly occurrences: number
}

export interface FailureRuntimeSnapshot {
  readonly failures: readonly PresentedFailure[]

  readonly degradedFeatures: readonly string[]

  readonly quarantinedDocuments: readonly string[]
}

export type FailureRuntimeListener = () => void

export type NonTerminalFailureInput = ClassifiedFailureInput & {
  readonly impact: NonTerminalFailureImpact
}

const EMPTY_SNAPSHOT: FailureRuntimeSnapshot = Object.freeze({
  failures: Object.freeze([]),
  degradedFeatures: Object.freeze([]),
  quarantinedDocuments: Object.freeze([]),
})

const MAX_PRESENTED_FAILURES = 20

export class FailureRuntime {
  private snapshot: FailureRuntimeSnapshot = EMPTY_SNAPSHOT

  private readonly listeners = new Set<FailureRuntimeListener>()

  private readonly degradedFeatures = new Set<string>()

  private readonly quarantinedDocuments = new Set<string>()

  readonly getSnapshot = (): FailureRuntimeSnapshot => {
    return this.snapshot
  }

  readonly subscribe = (listener: FailureRuntimeListener): (() => void) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  report(input: NonTerminalFailureInput): ClassifiedFailure {
    const failure = createClassifiedFailure(input)

    if (isTerminalFailureImpact(failure.impact)) {
      throw new Error('Terminal failures belong to the fatal incident runtime.')
    }

    this.recordOwnedDegradation(failure)

    const existing = this.snapshot.failures.find(
      (entry) => entry.failure.fingerprint === failure.fingerprint,
    )

    const retained = this.snapshot.failures.filter(
      (entry) => entry.failure.fingerprint !== failure.fingerprint,
    )

    const presented: PresentedFailure = Object.freeze({
      failure,
      occurrences: (existing?.occurrences ?? 0) + 1,
    })

    this.publish({
      failures: [...retained, presented].slice(-MAX_PRESENTED_FAILURES),

      degradedFeatures: [...this.degradedFeatures],

      quarantinedDocuments: [...this.quarantinedDocuments],
    })

    return failure
  }

  dismiss(failureId: string): void {
    const failures = this.snapshot.failures.filter((entry) => entry.failure.id !== failureId)

    if (failures.length === this.snapshot.failures.length) {
      return
    }

    this.publish({
      failures,
      degradedFeatures: this.snapshot.degradedFeatures,
      quarantinedDocuments: this.snapshot.quarantinedDocuments,
    })
  }

  resolveScope(scope: FailureScope): void {
    const scopeKey = createFailureScopeKey(scope)

    if (scope.kind === 'feature') {
      this.degradedFeatures.delete(scope.featureId)
    }

    if (scope.kind === 'document') {
      this.quarantinedDocuments.delete(scope.documentId)
    }

    this.publish({
      failures: this.snapshot.failures.filter(
        (entry) => createFailureScopeKey(entry.failure.scope) !== scopeKey,
      ),

      degradedFeatures: [...this.degradedFeatures],

      quarantinedDocuments: [...this.quarantinedDocuments],
    })
  }

  private recordOwnedDegradation(failure: ClassifiedFailure): void {
    if (failure.impact === 'feature-degraded' && failure.scope.kind === 'feature') {
      this.degradedFeatures.add(failure.scope.featureId)
    }

    if (failure.impact === 'document-fatal' && failure.scope.kind === 'document') {
      this.quarantinedDocuments.add(failure.scope.documentId)
    }
  }

  private publish(snapshot: FailureRuntimeSnapshot): void {
    this.snapshot = Object.freeze({
      failures: Object.freeze([...snapshot.failures]),

      degradedFeatures: Object.freeze([...snapshot.degradedFeatures]),

      quarantinedDocuments: Object.freeze([...snapshot.quarantinedDocuments]),
    })

    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error: unknown) {
        try {
          console.error('[Hybrid Canvas] Failure runtime listener failed', error)
        } catch {
          // No further recovery path.
        }
      }
    }
  }
}

export const failureRuntime = new FailureRuntime()
